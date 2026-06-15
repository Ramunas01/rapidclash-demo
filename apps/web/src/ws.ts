import type { Envelope, QueueJoinPayload, QueueLeavePayload, MoveMakePayload, MatchResumePayload, MatchStartPayload, MatchStatePayload, MatchYourTurnPayload, MatchEndPayload, QueueWaitingPayload, ErrorPayload, ChallengeSubscribePayload, ChallengeTakePayload, ChallengesListPayload, ChallengesUpdatePayload, ChallengeExpiredPayload } from '@rapidclash/shared';

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

export type WsMsgHandler = {
  onQueueWaiting?(payload: QueueWaitingPayload): void;
  onMatchStart?(payload: MatchStartPayload, matchId: string): void;
  onMatchState?(payload: MatchStatePayload, matchId: string): void;
  onMatchYourTurn?(payload: MatchYourTurnPayload, matchId: string): void;
  onMatchEnd?(payload: MatchEndPayload, matchId: string): void;
  onChallengesList?(payload: ChallengesListPayload): void;
  onChallengesUpdate?(payload: ChallengesUpdatePayload): void;
  onChallengeExpired?(payload: ChallengeExpiredPayload): void;
  onError?(payload: ErrorPayload): void;
};

export class WsClient {
  private ws: WebSocket | null = null;
  private token: string;
  private handlers: WsMsgHandler;
  private currentMatchId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(token: string, handlers: WsMsgHandler) {
    this.token = token;
    this.handlers = handlers;
    // Restore a match persisted across a full page reload so onopen auto-resumes
    // and onclose keeps reconnecting.
    this.currentMatchId = readStoredMatchId();
  }

  setHandlers(handlers: WsMsgHandler): void {
    this.handlers = handlers;
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
      if (resumeMatchId ?? this.currentMatchId) {
        this.send('match.resume', { matchId: resumeMatchId ?? this.currentMatchId } as MatchResumePayload);
      }
    };

    ws.onmessage = (ev: MessageEvent<string>) => {
      const msg = JSON.parse(ev.data) as Envelope;
      this.route(msg);
    };

    ws.onclose = () => {
      if (this.closed) return;
      if (this.currentMatchId) {
        // Reconnect after 2 s if mid-match
        this.reconnectTimer = setTimeout(() => this.connect(), 2000);
      }
    };
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
    }
  }

  send(type: string, payload: unknown, matchId?: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const env: Envelope = { type, payload, ...(matchId ? { matchId } : {}) };
      this.ws.send(JSON.stringify(env));
    }
  }

  joinQueue(gameId: string, stake: number): void {
    this.send('queue.join', { gameId, stake } as QueueJoinPayload);
  }

  leaveQueue(gameId: string): void {
    this.send('queue.leave', { gameId } as QueueLeavePayload);
  }

  /** Start receiving the open-challenge feed for a game (challenges.list, then updates). */
  subscribeChallenges(gameId: string): void {
    this.send('challenges.subscribe', { gameId } as ChallengeSubscribePayload);
  }

  unsubscribeChallenges(gameId: string): void {
    this.send('challenges.unsubscribe', { gameId } as ChallengeSubscribePayload);
  }

  /** Claim a specific resting bet. Escrow happens server-side only on a successful claim. */
  takeChallenge(matchId: string): void {
    this.send('challenge.take', { matchId } as ChallengeTakePayload);
  }

  makeMove(move: string, matchId: string): void {
    this.send('move.make', { move } as MoveMakePayload, matchId);
  }

  forfeit(matchId: string): void {
    this.send('match.forfeit', {}, matchId);
  }

  resume(matchId: string): void {
    this.setCurrentMatchId(matchId);
    this.send('match.resume', { matchId } as MatchResumePayload);
  }

  disconnect(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}
