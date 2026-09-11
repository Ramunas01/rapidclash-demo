import type { Envelope, Move, QueueJoinPayload, QueueLeavePayload, MoveMakePayload, MatchResumePayload, MatchStartPayload, MatchStatePayload, MatchYourTurnPayload, MatchEndPayload, QueueWaitingPayload, ErrorPayload, ChallengeSubscribePayload, ChallengeTakePayload, ChallengesListPayload, ChallengesUpdatePayload, ChallengeExpiredPayload, ChatSendPayload, ChatMessagePayload, ChatHistoryPayload } from '@rapidclash/shared';
import { UNTIMED_TIME_CONTROL } from '@rapidclash/shared';

const WS_BASE = import.meta.env.VITE_WS_URL ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

// Key under which the active matchId is persisted so a full page reload (not just a
// transient socket drop) can auto-resume. sessionStorage is per-tab and clears on tab
// close, which matches a match's lifetime — a stale id would forfeit after 60 s anyway.
const MATCH_ID_KEY = 'rc_currentMatchId';
// The active gameId is persisted alongside the matchId so a full reload mid-match can
// resume into the CORRECT play screen (RPS vs Coinflip), not just the right match.
const GAME_ID_KEY = 'rc_currentGameId';

function readStoredMatchId(): string | null {
  try {
    return sessionStorage.getItem(MATCH_ID_KEY);
  } catch {
    return null; // storage unavailable (private mode / SSR)
  }
}

function writeStoredMatchId(id: string | null): void {
  try {
    if (id) sessionStorage.setItem(MATCH_ID_KEY, id);
    else sessionStorage.removeItem(MATCH_ID_KEY);
  } catch {
    // storage unavailable — non-fatal; transient-drop resume still works in-memory.
  }
}

/** Read the persisted active gameId (set by the app when a match starts). */
export function readStoredGameId(): string | null {
  try {
    return sessionStorage.getItem(GAME_ID_KEY);
  } catch {
    return null;
  }
}

/** Persist/clear the active gameId in lockstep with the matchId. */
export function writeStoredGameId(id: string | null): void {
  try {
    if (id) sessionStorage.setItem(GAME_ID_KEY, id);
    else sessionStorage.removeItem(GAME_ID_KEY);
  } catch {
    // storage unavailable — non-fatal.
  }
}

/** True if a match is persisted from a prior session/reload — lets the app restore the play view on mount. */
export function hasStoredMatch(): boolean {
  return readStoredMatchId() !== null;
}

/** Connection lifecycle the UI can reflect (e.g. a "Reconnecting…" banner). */
export type WsStatus = 'connected' | 'reconnecting' | 'disconnected';

export type WsMsgHandler = {
  onQueueWaiting?(payload: QueueWaitingPayload): void;
  onMatchStart?(payload: MatchStartPayload, matchId: string): void;
  onMatchState?(payload: MatchStatePayload, matchId: string): void;
  onMatchYourTurn?(payload: MatchYourTurnPayload, matchId: string): void;
  onMatchEnd?(payload: MatchEndPayload, matchId: string): void;
  onChallengesList?(payload: ChallengesListPayload): void;
  onChallengesUpdate?(payload: ChallengesUpdatePayload): void;
  onChallengeExpired?(payload: ChallengeExpiredPayload): void;
  onStatus?(status: WsStatus): void;
  onError?(payload: ErrorPayload): void;
};

/** Chat's own handler slot (ticket 2026-09-11#7b) — deliberately NOT folded into `WsMsgHandler`
 *  above. `App.tsx` owns exactly one call to `setHandlers({...})` with every match/challenge
 *  handler wired in one place; chat, by contrast, is opened lazily from deep inside whichever hub
 *  screen is mounted (`useChat.ts`, called locally per-screen, same shape as `useMenuOverlay.ts`)
 *  and must be able to register its own handlers on the ALREADY-CONNECTED client without
 *  clobbering that one `setHandlers` call or requiring App.tsx to know chat exists. */
export type ChatMsgHandler = {
  onChatHistory?(payload: ChatHistoryPayload): void;
  onChatMessage?(payload: ChatMessagePayload): void;
};

export class WsClient {
  private ws: WebSocket | null = null;
  private token: string;
  private handlers: WsMsgHandler;
  private chatHandlers: ChatMsgHandler = {};
  private currentMatchId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private status: WsStatus = 'disconnected';
  private closed = false;

  // Exponential backoff: 1s → 2s → 4s → 8s → 10s (capped), reset on a successful open.
  private static readonly BASE_RECONNECT_MS = 1000;
  private static readonly MAX_RECONNECT_MS = 10000;

  constructor(token: string, handlers: WsMsgHandler) {
    this.token = token;
    this.handlers = handlers;
    // Restore a match persisted across a full page reload so onopen auto-resumes
    // and onclose keeps reconnecting.
    this.currentMatchId = readStoredMatchId();
    // Register as the one app-wide "active" client (see `getActiveWsClient` below) — always the
    // most-recently-constructed instance, matching App.tsx's own `wsRef.current = ws` handoff on
    // every (re)login/guest-auth/resume path.
    setActiveClient(this);
  }

  setHandlers(handlers: WsMsgHandler): void {
    this.handlers = handlers;
  }

  /** Chat's own, independent handler slot — see the `ChatMsgHandler` doc comment above. */
  setChatHandlers(handlers: ChatMsgHandler): void {
    this.chatHandlers = handlers;
  }

  getStatus(): WsStatus {
    return this.status;
  }

  private setStatus(status: WsStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.handlers.onStatus?.(status);
  }

  /** Update the active matchId in memory and in sessionStorage in lockstep. */
  private setCurrentMatchId(id: string | null): void {
    this.currentMatchId = id;
    writeStoredMatchId(id);
  }

  connect(resumeMatchId?: string): void {
    if (this.ws && this.ws.readyState <= 1) return; // CONNECTING or OPEN
    this.closed = false;
    const url = `${WS_BASE}/ws?token=${encodeURIComponent(this.token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0; // success → reset the backoff
      this.setStatus('connected');
      if (resumeMatchId ?? this.currentMatchId) {
        this.send('match.resume', { matchId: resumeMatchId ?? this.currentMatchId } as MatchResumePayload);
      }
    };

    ws.onmessage = (ev: MessageEvent<string>) => {
      const msg = JSON.parse(ev.data) as Envelope;
      this.route(msg);
    };

    ws.onclose = () => {
      if (this.closed) return; // intentional disconnect() → stay down
      // Always reconnect (not only mid-match) so an idle tab recovers after a drop.
      this.scheduleReconnect();
    };
  }

  /** Schedule a backed-off reconnect. Idempotent: a pending timer is not duplicated. */
  private scheduleReconnect(): void {
    this.setStatus('reconnecting');
    if (this.reconnectTimer !== null) return;
    const delay = Math.min(
      WsClient.MAX_RECONNECT_MS,
      WsClient.BASE_RECONNECT_MS * 2 ** this.reconnectAttempts,
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed) this.connect();
    }, delay);
  }

  private route(msg: Envelope): void {
    switch (msg.type) {
      case 'queue.waiting':
        this.handlers.onQueueWaiting?.(msg.payload as QueueWaitingPayload);
        break;
      case 'match.start': {
        // match.start carries the id in its payload (the contract field), not at the
        // envelope level — read it from there so persistence + resume actually fire.
        const startPayload = msg.payload as MatchStartPayload;
        const startId = startPayload.matchId ?? msg.matchId ?? null;
        this.setCurrentMatchId(startId);
        this.handlers.onMatchStart?.(startPayload, startId ?? '');
        break;
      }
      case 'match.state':
        this.handlers.onMatchState?.(msg.payload as MatchStatePayload, msg.matchId ?? '');
        break;
      case 'match.your_turn':
        this.handlers.onMatchYourTurn?.(msg.payload as MatchYourTurnPayload, msg.matchId ?? '');
        break;
      case 'match.end':
        this.setCurrentMatchId(null);
        this.handlers.onMatchEnd?.(msg.payload as MatchEndPayload, msg.matchId ?? '');
        break;
      case 'challenges.list':
        this.handlers.onChallengesList?.(msg.payload as ChallengesListPayload);
        break;
      case 'challenges.update':
        this.handlers.onChallengesUpdate?.(msg.payload as ChallengesUpdatePayload);
        break;
      case 'challenge.expired':
        this.handlers.onChallengeExpired?.(msg.payload as ChallengeExpiredPayload);
        break;
      case 'error':
        this.handlers.onError?.(msg.payload as ErrorPayload);
        break;
      case 'chat.history':
        this.chatHandlers.onChatHistory?.(msg.payload as ChatHistoryPayload);
        break;
      case 'chat.message':
        this.chatHandlers.onChatMessage?.(msg.payload as ChatMessagePayload);
        break;
    }
  }

  /** Send an envelope. Returns false (and never throws) if the socket isn't open, so
   *  callers can surface "reconnecting — try again" instead of silently dropping. */
  send(type: string, payload: unknown, matchId?: string): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const env: Envelope = { type, payload, ...(matchId ? { matchId } : {}) };
      this.ws.send(JSON.stringify(env));
      return true;
    }
    // Not open — nudge a reconnect if nothing is already in flight, then report failure.
    if (!this.closed && this.reconnectTimer === null && (!this.ws || this.ws.readyState === 3)) {
      this.connect();
    }
    return false;
  }

  /** `timeControlId` selects the chess pairing control; the server maps 'none' (the default for
   *  callers without a picker yet) to the game's default control, or keeps 'none' for untimed games. */
  joinQueue(gameId: string, stake: number, timeControlId: string = UNTIMED_TIME_CONTROL): boolean {
    return this.send('queue.join', { gameId, stake, timeControlId } as QueueJoinPayload);
  }

  leaveQueue(gameId: string): boolean {
    return this.send('queue.leave', { gameId } as QueueLeavePayload);
  }

  /** Start receiving the open-challenge feed for a game (challenges.list, then updates). */
  subscribeChallenges(gameId: string): boolean {
    return this.send('challenges.subscribe', { gameId } as ChallengeSubscribePayload);
  }

  unsubscribeChallenges(gameId: string): boolean {
    return this.send('challenges.unsubscribe', { gameId } as ChallengeSubscribePayload);
  }

  /** Claim a specific resting bet. Escrow happens server-side only on a successful claim. */
  takeChallenge(matchId: string): boolean {
    return this.send('challenge.take', { matchId } as ChallengeTakePayload);
  }

  /** `move` is the contract's opaque Move — a string for RPS/Coinflip, a {from,to,promotion?}
   *  object for chess. The server's game module validates the shape. */
  makeMove(move: Move, matchId: string): boolean {
    return this.send('move.make', { move } as MoveMakePayload, matchId);
  }

  forfeit(matchId: string): boolean {
    return this.send('match.forfeit', {}, matchId);
  }

  /** Offer a draw (games that declare the capability, e.g. chess). Asymmetric (CHESS_DRAW_OFFER.md
   *  rev 3): sending this only ever records your own offer — it never completes the match by itself. */
  drawOffer(matchId: string): boolean {
    return this.send('match.drawOffer', {}, matchId);
  }

  /** Withdraw your own pending draw offer. */
  drawRevoke(matchId: string): boolean {
    return this.send('match.drawRevoke', {}, matchId);
  }

  /** Accept the opponent's pending draw offer — the only way a draw offer completes the match. */
  drawAccept(matchId: string): boolean {
    return this.send('match.drawAccept', {}, matchId);
  }

  resume(matchId: string): boolean {
    this.setCurrentMatchId(matchId);
    return this.send('match.resume', { matchId } as MatchResumePayload);
  }

  /** Subscribe to the (only, general) chat room — no payload needed. Triggers an immediate
   *  `chat.history` reply, then adds this socket to the server's broadcast set. */
  subscribeChat(): boolean {
    return this.send('chat.subscribe', {});
  }

  /** Post one message to the chat room. Server-side validation (non-empty, ≤160 chars, kill
   *  switch) is authoritative — this is just the wire send; callers validate client-side first
   *  for UX (see `useChat.ts`). */
  sendChat(text: string): boolean {
    return this.send('chat.send', { text } as ChatSendPayload);
  }

  disconnect(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.setStatus('disconnected');
    if (activeClient === this) setActiveClient(null);
  }
}

// ─── Active-client singleton (ticket 2026-09-11#7b) ──────────────────────────────
// App.tsx is the sole owner of the app's one WsClient instance/WebSocket connection (constructed
// on login/guest-auth/resume, held in a local `useRef`, never exposed via props or context to the
// hub screens it renders). Chat's `useChat.ts` hook, however, is instantiated locally inside each
// hub screen — same shape as `useMenuOverlay.ts` — and needs to reuse that ONE live connection
// rather than opening a second WebSocket. Exposing the current instance as a module-level getter
// (set from the constructor/cleared from `disconnect()` above) lets it do that without any
// prop-threading or React context, mirroring how `api.ts` is already imported directly as a
// singleton by every screen instead of being passed down as a prop.
let activeClient: WsClient | null = null;

function setActiveClient(client: WsClient | null): void {
  activeClient = client;
}

/** The current app-wide `WsClient`, or `null` if nothing is connected yet (logged out, or a
 *  fresh app load before login/guest-auth resolves). Always the most recently constructed
 *  instance — see the constructor's own `setActiveClient(this)` above. */
export function getActiveWsClient(): WsClient | null {
  return activeClient;
}
