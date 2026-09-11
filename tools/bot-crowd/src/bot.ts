// A single demo bot: an ordinary REST+WS client (ADR-010) that mostly posts-and-
// waits so a human can JOIN it, and replies to its turn with a random legal move.

import { randomUUID } from 'node:crypto';
import type {
  ChallengesListPayload,
  ChallengesUpdatePayload,
  ErrorPayload,
  GameState,
  MatchEndPayload,
  MatchStartPayload,
  MatchStatePayload,
  MatchYourTurnPayload,
  Move,
  OpenChallenge,
  QueueWaitingPayload,
} from '@rapidclash/shared';
import { selectChessMove, selectBlackjackMove } from '@rapidclash/bot-heuristics';
import { config, moveDelayMsFor, BOT_PREFIX, HUMAN_RESERVED_STAKES, type BotConfig } from './config.js';
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

/** A roulette legal move, as the bot inspects it (mirrors the module's enumerable move set). */
type RouletteMoveLike = { t?: string; bet?: string; amount?: number };

/**
 * Roulette full-stack policy (smoke-test aid). A random move would shuffle chips forever and
 * rarely complete the full stack, so the bot instead goes ALL-IN on a random even-money colour and
 * then locks: pick the largest `place` amount on red/black (the "all remaining" option the module
 * offers → 1000 in one move) — choosing red vs black at random for round-to-round variance — and on
 * the next turn the `lock` move appears (full stack placed) and is taken. Returns null if neither
 * is available (lets the caller fall back to a random move, never wedging the bot).
 */
function rouletteMove(moves: Move[]): Move | null {
  const ms = moves as RouletteMoveLike[];
  const lock = moves.find((m): m is Move => !!m && typeof m === 'object' && (m as RouletteMoveLike).t === 'lock');
  if (lock) return lock;
  const evenMoney = ms.filter((m) => m && m.t === 'place' && (m.bet === 'red' || m.bet === 'black') && typeof m.amount === 'number');
  if (evenMoney.length === 0) return null;
  const maxAmt = Math.max(...evenMoney.map((m) => m.amount ?? 0));
  const allIn = evenMoney.filter((m) => m.amount === maxAmt); // the all-remaining options on red & black
  return (allIn[Math.floor(Math.random() * allIn.length)] ?? null) as Move | null;
}

/** Keno policy: take the `autofill` move — fills 8 seeded spots + locks in one move (a per-spot
 *  random pick would be slow and rarely complete the exact 8). Returns null if not offered. */
function kenoMove(moves: Move[]): Move | null {
  return (moves.find((m): m is Move => !!m && typeof m === 'object' && (m as { t?: string }).t === 'autofill') ?? null) as Move | null;
}

/** Limbo policy: take the `auto` move — auto-assigns a seeded target + locks in one move. */
function limboMove(moves: Move[]): Move | null {
  return (moves.find((m): m is Move => !!m && typeof m === 'object' && (m as { t?: string }).t === 'auto') ?? null) as Move | null;
}

/** Hilo policy: call hi/lo at random each card (excludes the internal `timeout` freeze move). */
function hiloMove(moves: Move[]): Move | null {
  const calls = moves.filter((m): m is Move => !!m && typeof m === 'object' && ((m as { t?: string }).t === 'hi' || (m as { t?: string }).t === 'lo'));
  return (calls.length ? calls[Math.floor(Math.random() * calls.length)] : null) as Move | null;
}

/**
 * Chess policy (issue #432): the shared, tested capture heuristic from
 * `@rapidclash/bot-heuristics` — the SAME implementation guest mode's Demo Opponent uses
 * (issue #278 §3), not a second copy that could drift. Deliberately imperfect: it evaluates every
 * capture, then a 50/50 gate throws half of its best moves away, so it plays like an honest,
 * fallible person rather than an engine.
 *
 * Unlike every other policy here it needs the full board, not just `legalMoves` — hence
 * `Bot.matchState`, fed by `match.start` + `match.state`. Returns null when that state is missing
 * or the heuristic can't produce a move, so the caller's `??`-chain falls back to a random legal
 * move and the bot never wedges. `playerId` is the bot's own server-assigned id.
 *
 * Exported standalone (pure — no bot/WS/HTTP state) so `move-policy.test.ts` can exercise the
 * wiring directly, matching `isTakeable`/`hasSufficientFunds`'s existing pattern in this file.
 */
export function chessMove(state: GameState | null, playerId: string, now: number = Date.now()): Move | null {
  if (state == null) return null;
  try {
    return selectChessMove(state, playerId, now) as Move;
  } catch {
    return null; // not our turn, malformed/partial state — let the caller fall back
  }
}

/**
 * Blackjack policy (issue #432): the shared hit/stand probability curve from
 * `@rapidclash/bot-heuristics` (issue #297's Owner-specified table — 100% at ≤14 tapering to 0% at
 * ≥19), replacing what was previously a pure coin-flip between `hit` and `stand`.
 *
 * Reads only the bot's OWN hand, so the `viewFor`-redacted state that arrives over the wire is
 * sufficient — no information the human opponent doesn't also have about their own hand. Same
 * null-on-failure contract as `chessMove` above.
 */
export function blackjackMove(state: GameState | null, playerId: string): Move | null {
  if (state == null) return null;
  try {
    return selectBlackjackMove(state, playerId) as Move;
  } catch {
    return null;
  }
}

/**
 * Would a taker claim this open challenge? Never another bot's own posting (BOT_PREFIX), never a
 * `HUMAN_RESERVED_STAKES` (`[2]` as of issue #384) challenge — that tier is reserved for human-vs-human —
 * and never `config.takerExcludeStake` (issue #362: the one stake two `Demo*`-prefixed reserved
 * accounts can deliberately pair with each other on, undisturbed; `0` = no stake excluded, a
 * no-op). Combined with the existing `TAKER_STAKE` (`0` = any stake) and `TAKER_ALLOW_PREFIX`
 * (issue #368: a username-prefix gate — e.g. `Demo` — replacing the earlier exact-name allowlist;
 * empty = any human owner) filters. This is the ONLY way a taker starts a match, so bots never
 * battle bots.
 *
 * Exported standalone (pure, no bot/WS/HTTP state) so `bot.test.ts` can exercise the exact
 * claiming rule directly; `tryTake()` below is the only production caller.
 */
export function isTakeable(c: OpenChallenge): boolean {
  return (
    !c.ownerName.startsWith(BOT_PREFIX) &&
    !HUMAN_RESERVED_STAKES.includes(c.stake) &&
    (config.takerExcludeStake === 0 || c.stake !== config.takerExcludeStake) &&
    (config.takerStake === 0 || c.stake === config.takerStake) &&
    (config.takerAllowPrefix === '' || c.ownerName.startsWith(config.takerAllowPrefix))
  );
}

/** Is `balance` already high enough (>= stake × `BOT_LOW_BALANCE_FACTOR`) to skip a top-up before
 *  risking `stake`? Pulled out of `ensureFunds` so the threshold math — which now has to scale
 *  across whatever stake a gated taker claims (issue #362), not just a rester's own fixed
 *  `cfg.stake` — is directly unit-testable without a live admin/WS connection. */
export function hasSufficientFunds(balance: number, stake: number): boolean {
  return balance >= stake * config.lowBalanceFactor;
}

export class Bot {
  private readonly ws: BotWsClient;
  private state: BotState = 'connecting';
  private playerId = '';
  private token = '';
  private balance = 0;
  private matchId: string | null = null;
  /**
   * Latest server-authoritative view of the CURRENT match's game state (issue #432) — seeded from
   * `match.start`'s payload and refreshed by every `match.state` broadcast. Always the `viewFor`
   * result, i.e. the opponent's hidden information is already stripped server-side before it
   * reaches this process; a bot sees exactly what a human client at the same seat sees.
   *
   * Deliberately NOT named `state`: `this.state` is this bot's own connection-lifecycle machine
   * ('connecting' | 'idle' | …), an entirely different thing. Null outside a match.
   *
   * Only Chess and Blackjack read it today — every other game's policy is a pure function of
   * `legalMoves` — but it is stored unconditionally, since `onMatchState` is registered once for
   * all games and the cost is one reference.
   */
  private matchState: GameState | null = null;
  /** One move in flight at a time. Roulette is concurrent (both bet at once), so the gateway
   *  resends `your_turn` to this bot whenever the OPPONENT places a chip — without this guard the
   *  bot would schedule duplicate all-ins from those resends (harmless but noisy rejections). */
  private movePending = false;
  private warnedNoAdmin = false;
  /** Crash: true once this bot has pre-set its auto-eject for the current match (set it once). */
  private crashActed = false;
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
        // Issue #432: `BotWsClient` has always routed `match.state`, but nothing was registered
        // here to receive it, so this process had zero game-state visibility. Chess/Blackjack
        // decisions need the actual board/hand, not just `legalMoves`.
        onMatchState: (p, id) => this.onMatchState(p, id),
        onMatchYourTurn: (p, id) => this.onMatchYourTurn(p, id),
        onMatchEnd: (p, id) => this.onMatchEnd(p, id),
        onChallengesList: (p) => this.onChallengesList(p),
        onChallengesUpdate: (p) => this.onChallengesUpdate(p),
        onChallengeExpired: () => this.onChallengeExpired(),
        onError: (p) => this.onError(p),
        onClose: () => this.onClose(),
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

  /** A dropped socket ends whatever session-scoped state ('resting'/'taking') was tied to the
   *  now-dead connection — a rester's posted challenge and a taker's in-flight take attempt both
   *  live only on the server side of that connection, gone the moment it closes. Reset to 'idle'
   *  so the reconnect's `onOpen` can actually re-rest/re-take instead of `rest()`'s own
   *  `this.state === 'resting'` guard silently no-op'ing forever on stale state (the bug behind
   *  bots going dark ~hourly — Cloud Run's request timeout force-closes every WS at that mark).
   *  Preserve the one exception `onOpen` already protects: a live match survives a reconnect. */
  private onClose(): void {
    this.log('socket closed');
    if (this.state !== 'in_match') this.state = 'idle';
  }

  // ── Rester: post-and-wait ──────────────────────────────────────────────────

  private async rest(): Promise<void> {
    if (this.state === 'in_match' || this.state === 'resting') return;
    await this.ensureFunds();
    if (this.ws.joinQueue(this.cfg.gameId, this.cfg.stake, this.cfg.timeControlId)) {
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

  // ── Taker: claim a HUMAN's open challenge (never another bot's) ─────────────

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

  /** Claim a HUMAN-posted open challenge this bot is eligible for (see `isTakeable`) — see that
   *  function's own doc comment for the exact filter. This is the ONLY way a taker starts a
   *  match, so bots never battle bots; only an eligible human posting gets a bot opponent. */
  private tryTake(): void {
    if (this.cfg.policy !== 'taker' || this.state !== 'idle') return;
    const target = [...this.openChallenges.values()].find(isTakeable);
    if (!target) return;
    this.state = 'taking';
    void this.claim(target);
  }

  /** Top up for `target`'s actual stake (a gated taker can now claim any allow-listed stake, not
   *  just a fixed one — issue #362 — so the funding check must key off the real target, not the
   *  BotConfig's decorative `stake` field), then take. Re-checks state/openChallenges after the
   *  await: the challenge may have been taken, expired, or this bot reset while topping up — in
   *  that case just bail and let the next challenges event re-trigger `tryTake()`. */
  private async claim(target: OpenChallenge): Promise<void> {
    await this.ensureFunds(target.stake);
    if (this.state !== 'taking' || !this.openChallenges.has(target.matchId)) return;
    this.log(`⚔ taking ${target.ownerName}'s challenge (${this.cfg.gameId} @ ${target.stake})`);
    if (!this.ws.takeChallenge(target.matchId)) this.state = 'idle';
  }

  // ── Match play (both policies) ─────────────────────────────────────────────

  private onMatchStart(p: MatchStartPayload, matchId: string): void {
    this.state = 'in_match';
    this.matchId = matchId;
    this.crashActed = false;
    this.movePending = false;
    this.matchState = p.state; // issue #432 — the opening position/deal, already viewFor'd
    this.log(`🎮 matched vs ${p.opponent.slice(0, 8)} (${p.gameId})`);
  }

  /** Every post-move state broadcast (issue #432). Ignores frames tagged for a different match —
   *  a late arrival from a just-ended match must not overwrite the live one's board. `match.state`
   *  is also the resume path's payload, so this doubles as reconnect recovery. */
  private onMatchState(p: MatchStatePayload, matchId: string): void {
    if (this.matchId !== null && matchId !== '' && matchId !== this.matchId) return;
    this.matchState = p.state;
  }

  private onMatchYourTurn(p: MatchYourTurnPayload, matchId: string): void {
    const moves = p.legalMoves;
    if (!moves || moves.length === 0) return;

    // Crash is continuous (no turns): legalMoves offers 'eject' + the auto-eject ladder. The bot
    // pre-sets a RANDOM auto-eject ONCE during SETUP and then idles — the server auto-ejects it at
    // that altitude. It never taps on the pad, and never wastes its eject on a mistimed climb tap.
    if (this.cfg.gameId === 'crash') {
      if (this.crashActed) return;
      const autos = moves.filter((m): m is string => typeof m === 'string' && m.startsWith('auto:') && m !== 'auto:off');
      if (autos.length === 0) return;
      const pick = autos[Math.floor(Math.random() * autos.length)];
      this.crashActed = true;
      // Crash's window is the SETUP phase, not a per-turn timer — see MOVE_DELAY_RANGES's note on
      // why crash's range has a hard ceiling it must never approach (a late preset = no preset).
      setTimeout(() => {
        if (this.state === 'in_match' && this.matchId === matchId) {
          if (this.ws.makeMove(pick, matchId)) this.log(`↳ auto-eject ${describeMove(pick)}`);
        }
      }, moveDelayMsFor(this.cfg.gameId));
      return;
    }

    if (this.movePending) return; // one move in flight (dedupes roulette's concurrent your_turn resends)
    // Roulette needs a full-stack policy (all-in on an even-money colour, then lock); Chess and
    // Blackjack use the shared heuristics (issue #432 — they read `this.matchState`, not just
    // `moves`); every other game is fine with a random legal move. Fall back to random if the
    // policy finds nothing.
    const move =
      (this.cfg.gameId === 'roulette' ? rouletteMove(moves) : null) ??
      (this.cfg.gameId === 'keno' ? kenoMove(moves) : null) ??
      (this.cfg.gameId === 'limbo' ? limboMove(moves) : null) ??
      (this.cfg.gameId === 'hilo' ? hiloMove(moves) : null) ??
      (this.cfg.gameId === 'chess' ? chessMove(this.matchState, this.playerId) : null) ??
      (this.cfg.gameId === 'blackjack' ? blackjackMove(this.matchState, this.playerId) : null) ??
      moves[Math.floor(Math.random() * moves.length)];
    // A "thinking" pause scaled to THIS game's real decision window and re-randomized per move
    // (issue #432), replacing the old flat 700ms every game shared — that single sub-second
    // constant was the one thing about the roster that read as structurally non-human.
    this.movePending = true;
    setTimeout(() => {
      this.movePending = false;
      if (this.state === 'in_match' && this.matchId === matchId) {
        if (this.ws.makeMove(move, matchId)) this.log(`↳ played ${describeMove(move)}`);
      }
    }, moveDelayMsFor(this.cfg.gameId));
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
    this.matchState = null; // don't carry a finished board into the next match (issue #432)
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

  /** `stake` defaults to `this.cfg.stake` (a rester's own posted stake). A taker passes the
   *  actual target's stake explicitly (issue #362) — its BotConfig `stake` field is decorative
   *  only (see `BotConfig`'s own doc comment), never the real amount it's about to risk. */
  private async ensureFunds(stake: number = this.cfg.stake): Promise<void> {
    if (hasSufficientFunds(this.balance, stake)) return;
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
          // Issue #532: MUST be durably unique per real top-up attempt, not just unique within one
          // process's lifetime. This used to be `${this.playerId}:${this.topUpSeq++}`, an in-memory
          // counter that resets to 0 on every restart — and bot-crowd restarts after every deploy
          // (standing runbook). On restart, a bot that previously needed a top-up would reuse the
          // same low-numbered key from its prior life; the ledger's idempotency correctly treated
          // that as a duplicate and returned the stale original entry with 200 OK, but the
          // `this.balance += entry.amount` below then credited that stale amount to the LOCAL
          // tracker regardless — so the bot's local balance silently drifted from the real
          // server-side balance and it got permanently stuck. A random UUID per attempt is
          // genuinely unique across restarts, so a duplicate can no longer occur here. (There's no
          // retry-safety need for a deterministic key: the catch block below never retries a failed
          // attempt with the same key — it just logs and gives up.)
          idempotencyKey: `botcrowd:topup:${this.playerId}:${randomUUID()}`,
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
