import { randomUUID, randomBytes } from 'node:crypto';
import type { GameModule, GameState, LedgerEntry, PlayerId, Rng, Move, ApplyResult, Outcome, OpenChallenge, PlayerClocks } from '@rapidclash/shared';
import { IllegalMove, UNTIMED_TIME_CONTROL } from '@rapidclash/shared';
import type { Ledger } from './ledger.js';
import type { MatchHistory } from './match-history.js';
import type { UsernameLookup } from './identity.js';

// ─── RNG ─────────────────────────────────────────────────────────────────────

// Mulberry32 — seeded, deterministic, reproducible. Never call Math.random.
function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return {
    next(): number {
      s += 0x6d2b79f5;
      let z = s;
      z = Math.imul(z ^ (z >>> 15), z | 1);
      z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
      return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
    },
    int(min, max): number {
      return min + Math.floor(this.next() * (max - min + 1));
    },
  };
}

/**
 * A module opts into per-player move timers by declaring a timeout + the auto-move (#91).
 * Exported so the WS gateway can apply the SAME predicate (e.g. to skip the socket-close
 * forfeit for these games — their absent players are auto-acted to a lock instead) without
 * branching on a gameId.
 */
export function usesPlayerTimers(mod: GameModule): boolean {
  return mod.meta.moveTimeoutMs != null && typeof mod.timeoutMove === 'function';
}

/** Cumulative per-player game clock (chess) — the SECOND mode of the per-player-timer
 *  subsystem. A player's whole budget ticks only on their turn; at 0 they lose on time. */
export function usesTimeControl(mod: GameModule): boolean {
  return mod.meta.timeControl != null;
}

/** Either per-player-timer mode (per-move reset OR cumulative clock). Used internally for the
 *  shared scheduling/sweep machinery and to take a clocked match OUT of the single per-match
 *  deadline (forfeit-the-laggard). NOTE: the gateway's close-forfeit skip keys off
 *  `usesPlayerTimers` only — a clocked game (chess) keeps the socket-close abandonment backstop
 *  (Q6/Q7), since its absent player isn't auto-acted, only drained. */
function hasPerPlayerClock(mod: GameModule): boolean {
  return usesPlayerTimers(mod) || usesTimeControl(mod);
}

/** Seed a cumulative clock onto a freshly-init'd state (the core has the formation `now`;
 *  the module's `init` does not). Generic — driven by the declared `timeControl`, no game-id
 *  branch. Part 1 always uses the default option; matchmaking carries a chosen id in Part 2. */
function seedTimeControl(
  state: GameState,
  mod: GameModule,
  players: [PlayerId, PlayerId],
  now: number,
  timeControlId: string,
): void {
  const tc = mod.meta.timeControl!;
  const opt = tc.options.find((o) => o.id === timeControlId)
    ?? tc.options.find((o) => o.id === tc.defaultId)
    ?? tc.options[0];
  const active = players.find((p) => mod.legalMoves(state, p).length > 0) ?? null;
  const clock: PlayerClocks = {
    remainingMs: { [players[0]]: opt.baseMs, [players[1]]: opt.baseMs },
    active,
    activeSince: now,
    timeControlId: opt.id,
  };
  (state as { clock?: PlayerClocks }).clock = clock;
}

/**
 * Resolve the effective time-control id a join should pair on. Untimed games are forced to the
 * 'none' sentinel (any requested value ignored). For a game with a declared `timeControl`:
 * an omitted or 'none' request → the game's default; an explicit id is validated against the
 * declared options (throws RangeError if unknown). Generic — no game-id branch.
 */
function resolveTimeControl(mod: GameModule, requested?: string): string {
  if (!usesTimeControl(mod)) return UNTIMED_TIME_CONTROL;
  const tc = mod.meta.timeControl!;
  if (requested === undefined || requested === UNTIMED_TIME_CONTROL) return tc.defaultId;
  if (!tc.options.some((o) => o.id === requested)) {
    throw new RangeError(`Unknown time control "${requested}" for game "${mod.meta.id}"`);
  }
  return requested;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueueEntry {
  playerId: PlayerId;
  /** Pre-generated at join time; becomes the canonical matchId for the match. */
  matchId: string;
  gameId: string;
  stake: number;
  /** The resolved control this entry pairs on ('none' for untimed games). Part of the FIFO key. */
  timeControlId: string;
  since: number;
  /** since + TTL. Server-authoritative; uniform across bets so oldest-first ≡ soonest-to-expire (OC9). */
  expiresAt: number;
}

export interface JoinWaiting {
  status: 'waiting';
  matchId: string;
  since: number;
  expiresAt: number;
  /** The resolved control this resting bet pairs on ('none' for untimed games). */
  timeControlId: string;
}

export interface JoinMatched {
  status: 'matched';
  matchId: string;
  opponentId: PlayerId;
  /** Raw state from module.init(); apply viewFor before sending to clients. */
  initialState: GameState;
}

export type JoinQueueResult = JoinWaiting | JoinMatched;

export interface MatchRecord {
  matchId: string;
  gameId: string;
  players: [PlayerId, PlayerId];
  state: GameState;
  stake: number;
  seed: number;
  /** The match's seeded RNG, retained from formation (already consumed by module.init).
   *  Continues the deterministic sequence for any later draws — e.g. per-player
   *  `timeoutMove` auto-actions — so the whole match stays reproducible from `seed`. */
  rng: Rng;
  /** Server-authoritative move deadline (#31). Set at match start, refreshed on every
   *  applyMove. Past this, sweepStaleMatches resolves the match independent of socket state.
   *  Used by games WITHOUT per-player timers (the default forfeit-the-laggard model). */
  deadlineAt: number;
  /** Per-player move deadlines, present only for games that opt into per-player timers
   *  (`meta.moveTimeoutMs` + `timeoutMove`). A player's entry exists iff they currently
   *  have legal moves; on expiry the core injects their `timeoutMove`. */
  playerDeadlines?: Record<PlayerId, number>;
}

export interface PlayerSettlement {
  /** Net wallet change: +stake − rake for the winner, −stake for the loser, 0 for draw/void. */
  delta: number;
  /** Derived balance after all settlement entries. */
  newBalance: number;
}

export interface SettledMatch {
  outcome: Outcome;
  settlement: Record<PlayerId, PlayerSettlement>;
}

export interface CompletedMatch extends MatchRecord {
  outcome: Outcome;
  settlement: Record<PlayerId, PlayerSettlement>;
}

/** Removed from the open-challenges store by the sweeper; returned so the gateway can notify. */
export interface ExpiredChallenge {
  matchId: string;
  ownerId: PlayerId;
  gameId: string;
}

/** An active match resolved by sweepStaleMatches because it blew its move deadline (#31).
 *  Already settled in the ledger (void → both refunded, or forfeit → non-responder loses),
 *  so no escrow is left orphaned; the gateway only needs to push match.end. Socket-free. */
export interface ResolvedStaleMatch {
  matchId: string;
  players: [PlayerId, PlayerId];
  outcome: Outcome;
  settlement: Record<PlayerId, PlayerSettlement>;
}

/** One auto-move the core injected because a player's per-player move timer expired
 *  (opt-in games only). The move was applied through the normal applyMove path, so the
 *  gateway broadcasts it like any other move: relay `state` (after viewFor) + `events`,
 *  then `match.end` if `terminal` (already settled), else `match.your_turn`. Socket-free. */
export interface TimedOutMove {
  matchId: string;
  gameId: string;
  players: [PlayerId, PlayerId];
  /** The player whose timer expired and whose move was auto-injected. */
  playerId: PlayerId;
  /** The injected (raw) state after the auto-move — apply viewFor before sending. */
  state: GameState;
  events: ApplyResult['events'];
  terminal: boolean;
  /** Present only when `terminal` — the settled result. */
  outcome?: Outcome;
  settlement?: Record<PlayerId, PlayerSettlement>;
}

/** A capped, ordered slice of the open-challenge feed for one game. */
export interface OpenChallengeList {
  entries: OpenChallenge[];
  /** How many eligible challenges exist beyond the cap (the "+N more" count). */
  more: number;
}

export type ChallengeErrorCode = 'CHALLENGE_TAKEN' | 'SELF_TAKE' | 'INSUFFICIENT_BALANCE';

/** Thrown by takeChallenge when a claim is refused. `code` maps to a gateway error code. */
export class ChallengeError extends Error {
  constructor(readonly code: ChallengeErrorCode, message: string) {
    super(message);
    this.name = 'ChallengeError';
  }
}

export interface MatchmakingOptions {
  /** Uniform platform TTL for resting bets. Default: env CHALLENGE_TTL_MS or 90000 (owner-confirmed 90s). */
  ttlMs?: number;
  /** Minimum rest before a bet is listable. Default: env CHALLENGE_MIN_REST_MS or 5000. */
  minRestMs?: number;
  /** Safe margin before expiry below which a bet is hidden. Default: env CHALLENGE_SAFE_MARGIN_MS or 3000. */
  safeMarginMs?: number;
  /** Max rows in a listing before "+N more". Default: env CHALLENGE_LIST_CAP or 5. */
  listCap?: number;
  /** Server-authoritative move timeout for an active match (#31). Default: env
   *  MATCH_TURN_TIMEOUT_MS or 120000 (owner-tunable). Injectable for tests. */
  turnTimeoutMs?: number;
  /** Resolve a playerId → display username for challenge owner names. */
  lookupUsername?: UsernameLookup;
  /** Injectable clock (testing). Default: Date.now. */
  now?: () => number;
}

export interface Matchmaking {
  /** `timeControlId` selects the pairing control (chess). Omitted/'none' → the game's default
   *  (or 'none' for untimed games); an explicit unknown id throws. Pairing is on
   *  (game, stake, time-control). */
  joinQueue(playerId: PlayerId, gameId: string, stake: number, timeControlId?: string): JoinQueueResult;
  leaveQueue(playerId: PlayerId, gameId: string, stake: number): LedgerEntry;
  /** Atomic specific-claim of a resting bet (OC3). Escrow on success only; throws ChallengeError on refusal. */
  takeChallenge(takerId: PlayerId, matchId: string): JoinMatched;
  /** Eligible (rested + safe margin), self-excluded, longest-waiting-first, capped, username-joined (OC2). */
  listOpenChallenges(gameId: string, viewerId: PlayerId, now?: number): OpenChallengeList;
  /** Remove + idempotently refund every bet past its TTL; return them so the gateway can notify (OC6). */
  sweepExpired(now?: number): ExpiredChallenge[];
  /** Resolve every active match past its move deadline (#31): void if no move was made (both
   *  refunded, no rake), else forfeit the non-responder. Settles each so escrow is never orphaned;
   *  returns the resolved matches so the gateway can push match.end. Socket-free, like sweepExpired. */
  sweepStaleMatches(now?: number): ResolvedStaleMatch[];
  /** For games that opt into per-player move timers (`meta.moveTimeoutMs` + `timeoutMove`):
   *  inject the declared auto-move for every player whose timer has expired, via the normal
   *  applyMove path, settling any that become terminal. Returns each injected move so the
   *  gateway can broadcast it. Games without per-player timers are untouched (they go through
   *  sweepStaleMatches instead). Socket-free, like the other sweepers. */
  sweepTimedOutMoves(now?: number): TimedOutMove[];
  getActiveMatch(matchId: string): MatchRecord | undefined;
  /** Apply a player's move. Throws IllegalMove if the move is not in legalMoves. */
  applyMove(matchId: string, playerId: PlayerId, move: Move, now: number): ApplyResult;
  /** Settle a terminal match. The rake rate is read from the match's game module meta
   *  (`rakeRate`), so the core never branches on the game id. Idempotent: a second call
   *  returns the stored result without touching the ledger. */
  settleMatch(matchId: string): SettledMatch;
  /** Apply forfeit for the quitter and immediately settle. Idempotent. */
  forfeitMatch(matchId: string, quitterId: PlayerId): SettledMatch;
  getCompletedMatch(matchId: string): CompletedMatch | undefined;
  /** Returns registered GameMeta for all registered game modules. */
  listGames(): Array<GameModule['meta']>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function createMatchmaking(
  ledger: Ledger,
  gameModules: GameModule[],
  matchHistory?: MatchHistory,
  options: MatchmakingOptions = {},
): Matchmaking {
  const moduleByGame = new Map<string, GameModule>(gameModules.map((m) => [m.meta.id, m]));

  // Open-challenge config — single source per knob: explicit option ?? env ?? default.
  const ttlMs = options.ttlMs ?? intEnv('CHALLENGE_TTL_MS', 90_000);
  const minRestMs = options.minRestMs ?? intEnv('CHALLENGE_MIN_REST_MS', 5_000);
  const safeMarginMs = options.safeMarginMs ?? intEnv('CHALLENGE_SAFE_MARGIN_MS', 3_000);
  const listCap = options.listCap ?? intEnv('CHALLENGE_LIST_CAP', 5);
  // Active-match move timeout (#31) — independent of socket state.
  const turnTimeoutMs = options.turnTimeoutMs ?? intEnv('MATCH_TURN_TIMEOUT_MS', 120_000);
  const lookupUsername = options.lookupUsername;
  const nowFn = options.now ?? (() => Date.now());

  // FIFO queues keyed by `${gameId}:${stake}` → [earliest, ...]
  const queues = new Map<string, QueueEntry[]>();

  // Reverse-lookup: which queue entry does this player currently hold?
  // Key: `${playerId}:${gameId}`
  const playerEntry = new Map<string, QueueEntry>();

  // Open-challenge index: canonical matchId → resting entry, for O(1) atomic claim/sweep.
  const entryByMatchId = new Map<string, QueueEntry>();

  /** Remove a resting entry from every index in one synchronous step (the claim/sweep primitive). */
  function removeEntry(entry: QueueEntry): void {
    const key = queueKey(entry.gameId, entry.stake, entry.timeControlId);
    const q = queues.get(key);
    if (q) {
      const idx = q.indexOf(entry);
      if (idx !== -1) q.splice(idx, 1);
      if (q.length === 0) queues.delete(key);
    }
    playerEntry.delete(`${entry.playerId}:${entry.gameId}`);
    entryByMatchId.delete(entry.matchId);
  }

  // Active matches
  const matches = new Map<string, MatchRecord>();

  // Completed matches (terminal, settled)
  const completed = new Map<string, CompletedMatch>();

  function queueKey(gameId: string, stake: number, timeControlId: string): string {
    return `${gameId}:${stake}:${timeControlId}`;
  }

  /**
   * Recompute a match's per-player deadlines (opt-in games only). A player's timer is
   * active iff they currently have legal moves: the player who just acted (`justActed`)
   * resets to `now + moveTimeoutMs`; a player who newly has moves starts a timer; a player
   * with no legal moves has theirs cleared; a still-waiting player keeps their running clock.
   */
  function refreshPlayerTimers(match: MatchRecord, mod: GameModule, now: number, justActed?: PlayerId): void {
    // Cumulative mode (chess): the wake is the active player's flag = activeSince + remaining.
    // The clock lives on the state (seeded by the core, advanced by the module's applyMove);
    // here we just read it to (re)schedule the single active deadline.
    if (usesTimeControl(mod)) {
      const clock = (match.state as { clock?: PlayerClocks }).clock;
      const deadlines: Record<PlayerId, number> = {};
      if (clock && clock.active != null && mod.legalMoves(match.state, clock.active).length > 0) {
        deadlines[clock.active] = clock.activeSince + clock.remainingMs[clock.active];
      }
      match.playerDeadlines = deadlines;
      return;
    }

    // Per-move mode (Blackjack/Mines): each player's timer resets to a fixed budget.
    const timeout = mod.meta.moveTimeoutMs!;
    const deadlines = match.playerDeadlines ?? {};
    for (const p of match.players) {
      const hasMoves = mod.legalMoves(match.state, p).length > 0;
      if (!hasMoves) {
        delete deadlines[p];
      } else if (p === justActed || deadlines[p] === undefined) {
        deadlines[p] = now + timeout;
      }
      // else: a waiting player's clock keeps running (unchanged).
    }
    match.playerDeadlines = deadlines;
  }

  function joinQueue(playerId: PlayerId, gameId: string, stake: number, timeControlId?: string): JoinQueueResult {
    const mod = moduleByGame.get(gameId);
    if (!mod) throw new Error(`Unknown gameId: ${gameId}`);

    const { minStake, maxStake } = mod.meta.bet;
    if (stake < minStake || stake > maxStake) {
      throw new RangeError(
        `Stake ${stake} out of range [${minStake}, ${maxStake}] for game "${gameId}"`,
      );
    }

    const balance = ledger.getBalance(playerId);
    if (balance < stake) {
      throw new Error(`Insufficient balance: have ${balance}, need ${stake}`);
    }

    // Resolve + validate the pairing control, then pair on (game, stake, time-control).
    const tcId = resolveTimeControl(mod, timeControlId);
    const key = queueKey(gameId, stake, tcId);
    const queue = queues.get(key) ?? [];

    // Is there already a waiting player?
    if (queue.length > 0) {
      const waiter = queue.shift()!;
      if (queue.length === 0) queues.delete(key);
      playerEntry.delete(`${waiter.playerId}:${gameId}`);
      entryByMatchId.delete(waiter.matchId); // no longer a resting open challenge

      // Use the waiter's pre-generated matchId as the canonical matchId.
      const matchId = waiter.matchId;

      // Escrow the joining player under the same canonical matchId.
      ledger.escrow(playerId, matchId, stake);

      // Initialise the game state.
      const seed = randomBytes(4).readUInt32LE(0);
      const rng = createRng(seed);
      const initialState = mod.init([waiter.playerId, playerId], rng);

      const record: MatchRecord = {
        matchId,
        gameId,
        players: [waiter.playerId, playerId],
        state: initialState,
        stake,
        seed,
        rng,
        deadlineAt: nowFn() + turnTimeoutMs,
      };
      matches.set(matchId, record);
      // Both players queued under the same key → the same control (the waiter's intrinsic one).
      if (usesTimeControl(mod)) seedTimeControl(record.state, mod, record.players, nowFn(), waiter.timeControlId);
      if (hasPerPlayerClock(mod)) refreshPlayerTimers(record, mod, nowFn());

      return { status: 'matched', matchId, opponentId: waiter.playerId, initialState };
    }

    // No waiter — add this player to the queue as an open challenge.
    const matchId = randomUUID();
    ledger.escrow(playerId, matchId, stake);

    const since = nowFn();
    const expiresAt = since + ttlMs;
    const entry: QueueEntry = { playerId, matchId, gameId, stake, timeControlId: tcId, since, expiresAt };
    queues.set(key, [...(queues.get(key) ?? []), entry]);
    playerEntry.set(`${playerId}:${gameId}`, entry);
    entryByMatchId.set(matchId, entry);

    return { status: 'waiting', matchId, since, expiresAt, timeControlId: tcId };
  }

  function leaveQueue(playerId: PlayerId, gameId: string, stake: number): LedgerEntry {
    const entryKey = `${playerId}:${gameId}`;
    const entry = playerEntry.get(entryKey);
    if (!entry) throw new Error(`Player ${playerId} is not in the queue for game "${gameId}"`);
    if (entry.stake !== stake) {
      throw new Error(`Stake mismatch: expected ${entry.stake}, got ${stake}`);
    }

    // Remove from queue (and the open-challenge index).
    removeEntry(entry);

    return ledger.refundEscrow(playerId, entry.matchId);
  }

  // ── Open challenges (ADR-008) ──────────────────────────────────────────────

  function takeChallenge(takerId: PlayerId, matchId: string): JoinMatched {
    // One synchronous critical section — JS is single-threaded, so two concurrent
    // takers of the same challenge cannot both pass: the first removes the entry
    // before yielding, and the second's lookup misses (CHALLENGE_TAKEN), never
    // escrowing. Every validation below runs BEFORE any escrow (OC3/OC4/OC5).
    const entry = entryByMatchId.get(matchId);
    if (!entry) {
      throw new ChallengeError('CHALLENGE_TAKEN', `Challenge "${matchId}" is no longer available`);
    }
    const ownerId = entry.playerId;
    if (takerId === ownerId) {
      throw new ChallengeError('SELF_TAKE', 'You cannot take your own challenge');
    }
    const mod = moduleByGame.get(entry.gameId);
    if (!mod) throw new Error(`Unknown gameId: ${entry.gameId}`);

    const balance = ledger.getBalance(takerId);
    if (balance < entry.stake) {
      throw new ChallengeError(
        'INSUFFICIENT_BALANCE',
        `Insufficient balance: have ${balance}, need ${entry.stake}`,
      );
    }

    // Claim it: drop from every index, THEN escrow + form the match (mirrors joinQueue's
    // matched branch — owner keeps players[0], the canonical matchId is the owner's).
    removeEntry(entry);
    ledger.escrow(takerId, matchId, entry.stake);

    const seed = randomBytes(4).readUInt32LE(0);
    const rng = createRng(seed);
    const initialState = mod.init([ownerId, takerId], rng);

    const record: MatchRecord = {
      matchId,
      gameId: entry.gameId,
      players: [ownerId, takerId],
      state: initialState,
      stake: entry.stake,
      seed,
      rng,
      deadlineAt: nowFn() + turnTimeoutMs,
    };
    matches.set(matchId, record);
    // The control is intrinsic to the resting challenge — taking it inherits the owner's.
    if (usesTimeControl(mod)) seedTimeControl(record.state, mod, record.players, nowFn(), entry.timeControlId);
    if (hasPerPlayerClock(mod)) refreshPlayerTimers(record, mod, nowFn());

    return { status: 'matched', matchId, opponentId: ownerId, initialState };
  }

  function listOpenChallenges(
    gameId: string,
    viewerId: PlayerId,
    now: number = nowFn(),
  ): OpenChallengeList {
    const eligible = [...entryByMatchId.values()]
      .filter(
        (e) =>
          e.gameId === gameId &&
          e.playerId !== viewerId && // exclude the viewer's own (OC4 also rejects server-side)
          now - e.since >= minRestMs && // rested long enough to read (OC2)
          e.expiresAt - now >= safeMarginMs, // safe margin so a tap won't land on a just-expired bet
      )
      // Longest-waiting first. Under the uniform TTL this is identical to
      // soonest-to-expire first (OC9): smaller `since` ⇒ smaller `expiresAt`.
      .sort((a, b) => a.since - b.since);

    const entries: OpenChallenge[] = eligible.slice(0, listCap).map((e) => ({
      matchId: e.matchId,
      ownerName: lookupUsername?.(e.playerId) ?? e.playerId,
      stake: e.stake,
      openedAt: e.since,
      expiresAt: e.expiresAt,
      timeControlId: e.timeControlId,
    }));

    return { entries, more: Math.max(0, eligible.length - listCap) };
  }

  function sweepExpired(now: number = nowFn()): ExpiredChallenge[] {
    const expired: ExpiredChallenge[] = [];
    for (const entry of [...entryByMatchId.values()]) {
      if (now < entry.expiresAt) continue;
      // Remove first so the same bet can never be swept (or refunded) twice. The
      // ledger refund is itself idempotency-keyed, so this is doubly safe (OC6).
      removeEntry(entry);
      ledger.refundEscrow(entry.playerId, entry.matchId);
      expired.push({ matchId: entry.matchId, ownerId: entry.playerId, gameId: entry.gameId });
    }
    return expired;
  }

  function sweepStaleMatches(now: number = nowFn()): ResolvedStaleMatch[] {
    const resolved: ResolvedStaleMatch[] = [];
    // Snapshot first: settleMatch/forfeitMatch delete from `matches`, so we must not
    // iterate the live map while mutating it.
    for (const match of [...matches.values()]) {
      const mod = moduleByGame.get(match.gameId)!;
      // Any per-player-clock game (per-move timers OR a cumulative time control) is out of the
      // single per-match deadline: per-move games resolve via sweepTimedOutMoves' auto-move,
      // clocked games via the loss-on-time flag there. For a clocked game the per-move
      // MATCH_TURN_TIMEOUT_MS is OFF — the budget is the only in-game limit (Q6).
      if (hasPerPlayerClock(mod)) continue;
      if (now < match.deadlineAt) continue;
      // Non-responders = players who still owe a legal move. In our 2-player games this is
      // either the single laggard (the other side already moved → that laggard forfeits and
      // loses) or, before any decisive move, everyone still owes one (the module's forfeit
      // yields `void` → both refunded, no rake). Player order is stable, so the pick is
      // deterministic. Delegating to forfeitMatch reuses the module's own
      // "forfeit, or void if pre-first-move" contract, keeping this game-agnostic.
      const pending = match.players.filter((p) => mod.legalMoves(match.state, p).length > 0);
      const settled =
        pending.length > 0
          ? forfeitMatch(match.matchId, pending[0])
          : settleMatch(match.matchId); // already terminal but unsettled — just settle
      resolved.push({
        matchId: match.matchId,
        players: match.players,
        outcome: settled.outcome,
        settlement: settled.settlement,
      });
    }
    return resolved;
  }

  function sweepTimedOutMoves(now: number = nowFn()): TimedOutMove[] {
    const out: TimedOutMove[] = [];
    // Snapshot: settleMatch deletes from `matches` on a terminal auto-move.
    for (const match of [...matches.values()]) {
      const mod = moduleByGame.get(match.gameId)!;
      if (!hasPerPlayerClock(mod)) continue;

      // Cumulative mode (chess): the active player flags when their budget hits 0 with no move.
      // Resolve through the module's loss-on-time path (forfeit → opponent wins, or void if it
      // was pre-first-move) and settle exactly like any decisive loss (rake once, idempotent).
      if (usesTimeControl(mod)) {
        const clock = (match.state as { clock?: PlayerClocks }).clock;
        const deadlines = match.playerDeadlines ?? {};
        const active = clock?.active ?? null;
        if (
          active != null &&
          deadlines[active] !== undefined &&
          now >= deadlines[active] &&
          mod.legalMoves(match.state, active).length > 0
        ) {
          const settled = forfeitMatch(match.matchId, active); // sets terminal state + settles
          const done = completed.get(match.matchId);
          out.push({
            matchId: match.matchId,
            gameId: match.gameId,
            players: match.players,
            playerId: active,
            state: done ? done.state : match.state,
            // Record the flag with its `now` so the event (relayed + loggable) reproduces on replay.
            events: [{ type: 'flagged', payload: { playerId: active, now } }],
            terminal: true,
            outcome: settled.outcome,
            settlement: settled.settlement,
          });
        }
        continue;
      }

      // Inject an auto-move for each expired player. State changes between injections, so
      // re-evaluate every iteration. Bounded to avoid any runaway loop.
      let guard = 0;
      while (guard++ < 64) {
        const deadlines = match.playerDeadlines ?? {};
        const p = match.players.find(
          (pl) =>
            deadlines[pl] !== undefined &&
            now >= deadlines[pl] &&
            mod.legalMoves(match.state, pl).length > 0,
        );
        if (p === undefined) break;

        let result: ApplyResult;
        try {
          // timeoutMove must return a currently-legal move; applyMove validates it and
          // resets this player's timer. The seeded match rng keeps the auto-move deterministic.
          const move = mod.timeoutMove!(match.state, p, match.rng);
          result = applyMove(match.matchId, p, move, now);
        } catch {
          // A misbehaving module must not wedge the sweep: drop this player's timer and
          // leave the match for the disconnect/forfeit backstop.
          match.playerDeadlines = { ...deadlines };
          delete match.playerDeadlines[p];
          continue;
        }

        const terminal = mod.isTerminal(result.state);
        const entry: TimedOutMove = {
          matchId: match.matchId,
          gameId: match.gameId,
          players: match.players,
          playerId: p,
          state: result.state,
          events: result.events,
          terminal,
        };
        if (terminal) {
          const settled = settleMatch(match.matchId);
          entry.outcome = settled.outcome;
          entry.settlement = settled.settlement;
          out.push(entry);
          break; // match is now removed from `matches`
        }
        out.push(entry);
      }
    }
    return out;
  }

  function getActiveMatch(matchId: string): MatchRecord | undefined {
    return matches.get(matchId);
  }

  function applyMove(matchId: string, playerId: PlayerId, move: Move, now: number): ApplyResult {
    const match = matches.get(matchId);
    if (!match) throw new Error(`Match not found: ${matchId}`);
    if (!match.players.includes(playerId)) {
      throw new Error(`Player ${playerId} is not in match ${matchId}`);
    }

    const mod = moduleByGame.get(match.gameId)!;
    const legal = mod.legalMoves(match.state, playerId);

    // Use JSON comparison for move equality so module's Move type (unknown) compares correctly.
    const moveJson = JSON.stringify(move);
    if (!legal.some((m) => JSON.stringify(m) === moveJson)) {
      throw new IllegalMove(`Move "${String(move)}" is not legal for player ${playerId} in match ${matchId}`);
    }

    const result = mod.applyMove(match.state, move, { playerId, now });
    match.state = result.state;
    // A move was made → the match is progressing; push the deadline out so an active,
    // responsive match is never swept as stale (#31).
    match.deadlineAt = now + turnTimeoutMs;
    // Per-player timers (per-move OR cumulative): the module's applyMove already advanced a
    // cumulative clock; here we (re)schedule the active deadline for either mode.
    if (hasPerPlayerClock(mod)) refreshPlayerTimers(match, mod, now, playerId);
    return result;
  }

  function settleMatch(matchId: string): SettledMatch {
    // Idempotent: if already completed, return stored result without touching the ledger.
    const existing = completed.get(matchId);
    if (existing) return { outcome: existing.outcome, settlement: existing.settlement };

    const match = matches.get(matchId);
    if (!match) throw new Error(`Match not found: ${matchId}`);

    const mod = moduleByGame.get(match.gameId)!;
    // Rake is declared per game in the module meta — the core applies it generically and
    // never tests which game this is (invariant #5).
    const feeRate = mod.meta.rakeRate;
    const outcome = mod.outcome(match.state);

    const pot = match.stake * 2;
    const winnerId = outcome.type === 'win' ? outcome.winner : undefined;

    ledger.settle(matchId, outcome.type, winnerId, pot, feeRate);
    matchHistory?.recordResult(matchId, match.gameId, match.players, outcome.type, winnerId, match.stake);

    const rake = outcome.type === 'win' ? Math.round(pot * feeRate) : 0;
    const stake = match.stake;

    const settlement: Record<PlayerId, PlayerSettlement> = {};
    for (const pid of match.players) {
      let delta: number;
      if (outcome.type === 'win') {
        delta = pid === winnerId ? stake - rake : -stake;
      } else {
        // draw or void: stake was escrowed then fully refunded — net zero
        delta = 0;
      }
      settlement[pid] = { delta, newBalance: ledger.getBalance(pid) };
    }

    const completedMatch: CompletedMatch = { ...match, outcome, settlement };
    completed.set(matchId, completedMatch);
    matches.delete(matchId);

    return { outcome, settlement };
  }

  function forfeitMatch(matchId: string, quitterId: PlayerId): SettledMatch {
    // Idempotent: if already settled, return stored result.
    const existing = completed.get(matchId);
    if (existing) return { outcome: existing.outcome, settlement: existing.settlement };

    const match = matches.get(matchId);
    if (!match) throw new Error(`Match not found: ${matchId}`);
    if (!match.players.includes(quitterId)) {
      throw new Error(`Player ${quitterId} is not in match ${matchId}`);
    }

    const mod = moduleByGame.get(match.gameId)!;
    const terminalState = mod.forfeit(match.state, quitterId);
    match.state = terminalState;

    // settleMatch reads the rake rate from the game module meta.
    return settleMatch(matchId);
  }

  function getCompletedMatch(matchId: string): CompletedMatch | undefined {
    return completed.get(matchId);
  }

  function listGames(): Array<GameModule['meta']> {
    return gameModules.map((m) => m.meta);
  }

  return {
    joinQueue,
    leaveQueue,
    takeChallenge,
    listOpenChallenges,
    sweepExpired,
    sweepStaleMatches,
    sweepTimedOutMoves,
    getActiveMatch,
    applyMove,
    settleMatch,
    forfeitMatch,
    getCompletedMatch,
    listGames,
  };
}
