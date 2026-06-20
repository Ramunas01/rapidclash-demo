// Node WebSocket client for a single bot. This is apps/web/src/ws.ts adapted for
// Node: it uses the `ws` package instead of the browser WebSocket, drops the
// sessionStorage/location persistence (a bot has no tab to reload), and keeps the
// same message names and shared payload types so it speaks the exact wire protocol
// a human client does (ADR-010: bots are ordinary clients).

import WebSocket from 'ws';
import type {
  ChallengeExpiredPayload,
  ChallengesListPayload,
  ChallengesUpdatePayload,
  Envelope,
  ErrorPayload,
  MatchEndPayload,
  MatchStartPayload,
  MatchStatePayload,
  MatchYourTurnPayload,
  Move,
  MoveMakePayload,
  QueueJoinPayload,
  QueueLeavePayload,
  QueueWaitingPayload,
  ChallengeSubscribePayload,
  ChallengeTakePayload,
} from '@rapidclash/shared';

export interface BotWsHandlers {
  onOpen?(): void;
  onQueueWaiting?(payload: QueueWaitingPayload): void;
  onMatchStart?(payload: MatchStartPayload, matchId: string): void;
  onMatchState?(payload: MatchStatePayload, matchId: string): void;
  onMatchYourTurn?(payload: MatchYourTurnPayload, matchId: string): void;
  onMatchEnd?(payload: MatchEndPayload, matchId: string): void;
  onChallengesList?(payload: ChallengesListPayload): void;
  onChallengesUpdate?(payload: ChallengesUpdatePayload): void;
  onChallengeExpired?(payload: ChallengeExpiredPayload): void;
  onError?(payload: ErrorPayload): void;
  onClose?(): void;
}

export class BotWsClient {
  private ws: WebSocket | null = null;
  private closed = false;
  private token = '';

  constructor(
    private readonly endpoint: string,
    private readonly handlers: BotWsHandlers,
    private readonly reconnectDelayMs: number,
  ) {}

  /** Open the connection. The token is remembered so auto-reconnects reuse it. */
  connect(token?: string): void {
    if (token !== undefined) this.token = token;
    this.closed = false;
    const url = `${this.endpoint}?token=${encodeURIComponent(this.token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => this.handlers.onOpen?.());
    ws.on('message', (data: WebSocket.RawData) => {
      let msg: Envelope;
      try {
        msg = JSON.parse(data.toString()) as Envelope;
      } catch {
        return; // ignore non-JSON frames
      }
      this.route(msg);
    });
    ws.on('error', () => {
      /* surfaced via the subsequent close; nothing actionable here */
    });
    ws.on('close', () => {
      this.handlers.onClose?.();
      if (!this.closed) setTimeout(() => this.connect(), this.reconnectDelayMs);
    });
  }

  private route(msg: Envelope): void {
    switch (msg.type) {
      case 'queue.waiting':
        this.handlers.onQueueWaiting?.(msg.payload as QueueWaitingPayload);
        break;
      case 'match.start': {
        const payload = msg.payload as MatchStartPayload;
        this.handlers.onMatchStart?.(payload, payload.matchId ?? msg.matchId ?? '');
        break;
      }
      case 'match.state':
        this.handlers.onMatchState?.(msg.payload as MatchStatePayload, msg.matchId ?? '');
        break;
      case 'match.your_turn':
        this.handlers.onMatchYourTurn?.(msg.payload as MatchYourTurnPayload, msg.matchId ?? '');
        break;
      case 'match.end':
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

  private send(type: string, payload: unknown, matchId?: string): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    const env: Envelope = { type, payload, ...(matchId ? { matchId } : {}) };
    this.ws.send(JSON.stringify(env));
    return true;
  }

  joinQueue(gameId: string, stake: number, timeControlId?: string): boolean {
    return this.send('queue.join', { gameId, stake, ...(timeControlId ? { timeControlId } : {}) } as QueueJoinPayload);
  }

  leaveQueue(gameId: string): boolean {
    return this.send('queue.leave', { gameId } as QueueLeavePayload);
  }

  subscribeChallenges(gameId: string): boolean {
    return this.send('challenges.subscribe', { gameId } as ChallengeSubscribePayload);
  }

  takeChallenge(matchId: string): boolean {
    return this.send('challenge.take', { matchId } as ChallengeTakePayload);
  }

  makeMove(move: Move, matchId: string): boolean {
    return this.send('move.make', { move } as MoveMakePayload, matchId);
  }

  disconnect(): void {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }
}
