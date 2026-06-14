import type { Envelope, QueueJoinPayload, QueueLeavePayload, MoveMakePayload, MatchResumePayload, MatchStartPayload, MatchStatePayload, MatchYourTurnPayload, MatchEndPayload, QueueWaitingPayload, ErrorPayload } from '@rapidclash/shared';

const WS_BASE = import.meta.env.VITE_WS_URL ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

export type WsMsgHandler = {
  onQueueWaiting?(payload: QueueWaitingPayload): void;
  onMatchStart?(payload: MatchStartPayload, matchId: string): void;
  onMatchState?(payload: MatchStatePayload, matchId: string): void;
  onMatchYourTurn?(payload: MatchYourTurnPayload, matchId: string): void;
  onMatchEnd?(payload: MatchEndPayload, matchId: string): void;
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
  }

  setHandlers(handlers: WsMsgHandler): void {
    this.handlers = handlers;
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
      case 'match.start':
        this.currentMatchId = msg.matchId ?? null;
        this.handlers.onMatchStart?.(msg.payload as MatchStartPayload, msg.matchId ?? '');
        break;
      case 'match.state':
        this.handlers.onMatchState?.(msg.payload as MatchStatePayload, msg.matchId ?? '');
        break;
      case 'match.your_turn':
        this.handlers.onMatchYourTurn?.(msg.payload as MatchYourTurnPayload, msg.matchId ?? '');
        break;
      case 'match.end':
        this.currentMatchId = null;
        this.handlers.onMatchEnd?.(msg.payload as MatchEndPayload, msg.matchId ?? '');
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

  makeMove(move: string, matchId: string): void {
    this.send('move.make', { move } as MoveMakePayload, matchId);
  }

  forfeit(matchId: string): void {
    this.send('match.forfeit', {}, matchId);
  }

  resume(matchId: string): void {
    this.currentMatchId = matchId;
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
