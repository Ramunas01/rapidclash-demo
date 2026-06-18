// A single demo bot: an ordinary REST+WS client (ADR-010) that mostly posts-and-
// waits so a human can JOIN it, and replies to its turn with a random legal move.

import type {
  ChallengesListPayload,
  ChallengesUpdatePayload,
  ErrorPayload,
  MatchEndPayload,
  MatchStartPayload,
  MatchYourTurnPayload,
  Move,
  OpenChallenge,
  QueueWaitingPayload,
} from '@rapidclash/shared';
import { config, type BotConfig } from './config.js';
import { HttpError, type Api } from './http.js';
import { BotWsClient } from './ws-client.js';

type BotState = 'connecting' | 'idle' | 'resting' | 'taking' | 'in_match';

/** Lets a bot fetch the (shared) admin token for top-ups; null if admin login failed. */
export type AdminTokenProvider = () => string | null;

/** Human-readable form of an opaque Move for logs (RPS/Coinflip string, chess object). */
function describeMove(move: Move): string {
  if (typeof move === 'string') return move;
  if (move && typeof move === 'object') {
    const m = move as { from?: string; to?: string; promotion?: string };
    if (m.from && m.to) return `${m.from}${m.to}${m.promotion ?? ''}`;
  }
  return JSON.stringify(move);
}

export class Bot {
  private readonly ws: BotWsClient;
  private state: BotState = 'connecting';
  private playerId = '';
  private token = '';
  private balance = 0;
  private matchId: string | null = null;
  private topUpSeq = 0;
  private warnedNoAdmin = false;
  /** Open challenges currently visible on this bot's game feed (takers only). */
  private readonly openChallenges = new Map<string, OpenChallenge>();

  constructor(
    private readonly cfg: BotConfig,
    private readonly api: Api,
    private readonly getAdminToken: AdminTokenProvider,
  ) {
    // The token is supplied to ws.connect() once start() has authenticated.
    this.ws = new BotWsClient(
      config.wsEndpoint,
      {
        onOpen: () => this.onOpen(),
        onQueueWaiting: (p) => this.onQueueWaiting(p),
        onMatchStart: (p, id) => this.onMatchStart(p, id),
        onMatchYourTurn: (p, id) => this.onMatchYourTurn(p, id),
        onMatchEnd: (p, id) => this.onMatchEnd(p, id),
        onChallengesList: (p) => this.onChallengesList(p),
        onChallengesUpdate: (p) => this.onChallengesUpdate(p),
        onChallengeExpired: () => this.onChallengeExpired(),
        onError: (p) => this.onError(p),
        onClose: () => this.log('socket closed'),
      },
      config.reconnectDelayMs,
    );
  }

  private log(msg: string): void {
    console.log(`${this.cfg.name.padEnd(10)} ${msg}`);
  }

  /** Register (or log in if the account already exists), then open the WS connection. */
  async start(): Promise<void> {
    const creds = { username: this.cfg.name, password: config.botPassword };
    try {
      const res = await this.api.register(creds);
      this.token = res.token;
      this.playerId = res.playerId;
      this.balance = res.balance;
      this.log(`registered (${this.cfg.gameId} @ ${this.cfg.stake}, ${this.cfg.policy}) — balance ${this.balance}`);
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        const res = await this.api.login(creds);
        this.token = res.token;
        this.playerId = res.playerId;
        this.balance = res.balance;
        this.log(`logged in (${this.cfg.gameId} @ ${this.cfg.stake}, ${this.cfg.policy}) — balance ${this.balance}`);
      } else {
        throw err;
      }
    }
    this.ws.connect(this.token);
  }

  private onOpen(): void {
    // (Re)establish the bot's standing behaviour. Don't disturb a live match.
    if (this.state === 'in_match') return;
    if (this.cfg.policy === 'taker') {
      this.state = 'idle';
      this.ws.subscribeChallenges(this.cfg.gameId);
      this.tryTake();
    } else {
      void this.rest();
    }
  }

  // ── Rester: post-and-wait ──────────────────────────────────────────────────

  private async rest(): Promise<void> {
    if (this.state === 'in_match' || this.state === 'resting') return;
    await this.ensureFunds();
    if (this.ws.joinQueue(this.cfg.gameId, this.cfg.stake)) {
      this.state = 'resting';
    }
  }

  private onQueueWaiting(_p: QueueWaitingPayload): void {
    this.log(`⏳ resting as open challenge — ${this.cfg.gameId} @ ${this.cfg.stake} (waiting for a JOIN)`);
  }

  private onChallengeExpired(): void {
    this.log('challenge expired — re-posting');
    this.state = 'idle';
    this.scheduleRepost();
  }

  private scheduleRepost(): void {
    if (this.cfg.policy !== 'rester') return;
    setTimeout(() => void this.rest(), config.repostDelayMs);
  }

  // ── Taker: claim a peer bot's challenge in its own lane, for light motion ───

  private onChallengesList(p: ChallengesListPayload): void {
    if (p.gameId !== this.cfg.gameId) return;
    this.openChallenges.clear();
    for (const c of p.entries) this.openChallenges.set(c.matchId, c);
    this.tryTake();
  }

  private onChallengesUpdate(p: ChallengesUpdatePayload): void {
    if (p.gameId !== this.cfg.gameId) return;
    if (p.removed) this.openChallenges.delete(p.removed.matchId);
    if (p.added) this.openChallenges.set(p.added.matchId, p.added);
    this.tryTake();
  }

  /** Take a peer challenge scoped to THIS bot's exact (gameId, stake) lane only, so it
   *  never claims the distinct-stake challenges left open for the human. */
  private tryTake(): void {
    if (this.cfg.policy !== 'taker' || this.state !== 'idle') return;
    const target = [...this.openChallenges.values()].find(
      (c) => c.stake === this.cfg.stake && c.ownerName !== this.cfg.name,
    );
    if (!target) return;
    this.state = 'taking';
    this.log(`⚔ taking ${target.ownerName}'s challenge (${this.cfg.gameId} @ ${target.stake})`);
    if (!this.ws.takeChallenge(target.matchId)) this.state = 'idle';
  }

  // ── Match play (both policies) ─────────────────────────────────────────────

  private onMatchStart(p: MatchStartPayload, matchId: string): void {
    this.state = 'in_match';
    this.matchId = matchId;
    this.log(`🎮 matched vs ${p.opponent.slice(0, 8)} (${p.gameId})`);
  }

  private onMatchYourTurn(p: MatchYourTurnPayload, matchId: string): void {
    const moves = p.legalMoves;
    if (!moves || moves.length === 0) return;
    const move = moves[Math.floor(Math.random() * moves.length)];
    // A brief "thinking" pause keeps cadence human-ish and the server unflooded.
    setTimeout(() => {
      if (this.state === 'in_match' && this.matchId === matchId) {
        if (this.ws.makeMove(move, matchId)) this.log(`↳ played ${describeMove(move)}`);
      }
    }, config.moveDelayMs);
  }

  private onMatchEnd(p: MatchEndPayload, _matchId: string): void {
    this.balance = p.settlement.newBalance;
    const verdict =
      p.outcome.type === 'void'
        ? 'void'
        : p.outcome.type === 'draw'
          ? 'draw'
          : p.outcome.winner === this.playerId
            ? 'WON'
            : 'lost';
    this.log(`🏁 ${verdict} (${p.settlement.delta >= 0 ? '+' : ''}${p.settlement.delta}) — balance ${this.balance}`);
    this.matchId = null;
    this.state = 'idle';
    if (this.cfg.policy === 'rester') this.scheduleRepost();
    else this.tryTake();
  }

  private onError(p: ErrorPayload): void {
    this.log(`⚠ ${p.code}: ${p.message}`);
    // A take that lost the race, or a rest that hit insufficient balance — recover.
    if (this.state === 'taking') {
      this.state = 'idle';
      this.tryTake();
    } else if (p.code === 'INSUFFICIENT_BALANCE') {
      this.state = 'idle';
      void this.ensureFunds().then(() => this.scheduleRepost());
    }
  }

  // ── Funding ────────────────────────────────────────────────────────────────

  private async ensureFunds(): Promise<void> {
    if (this.balance >= this.cfg.stake * config.lowBalanceFactor) return;
    const adminToken = this.getAdminToken();
    if (!adminToken) {
      if (!this.warnedNoAdmin) {
        this.log('low balance and no admin token — skipping top-up (set ADMIN_PASSWORD to enable)');
        this.warnedNoAdmin = true;
      }
      return;
    }
    try {
      const entry = await this.api.adminCredit(
        this.playerId,
        {
          amount: config.topUpAmount,
          idempotencyKey: `botcrowd:topup:${this.playerId}:${this.topUpSeq++}`,
        },
        adminToken,
      );
      this.balance += entry.amount;
      this.log(`💰 topped up +${entry.amount} — balance ${this.balance}`);
    } catch (err) {
      this.log(`top-up failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Best-effort graceful shutdown: leave the queue so the resting bet clears, then close. */
  shutdown(): void {
    if (this.state === 'resting') this.ws.leaveQueue(this.cfg.gameId);
    this.ws.disconnect();
  }
}
