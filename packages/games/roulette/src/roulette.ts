import type {
  ApplyResult,
  GameEvent,
  GameMeta,
  GameModule,
  GameState,
  Move,
  MoveContext,
  Outcome,
  PlayerId,
  Rng,
} from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';
import {
  AUTO_SPREAD_BETS,
  BETS,
  BETTING_TIMEOUT_MS,
  CHIP_TOTAL,
  CHIP_UNIT,
  PLACE_DENOMS,
  REPLAY_CAP,
  betById,
  pocketFor,
  scoreAllocation,
} from './wheel.js';

/**
 * Roulette — PvP, two players bet on ONE shared spin of a zeroless 36-pocket wheel; the larger
 * chip stack after the spin wins the (play-money) pot. See docs/ROULETTE.md.
 *
 * TWO CURRENCIES, kept strictly separate:
 *   • Chips (CHIP_TOTAL each) — internal scoring units, game state only. NEVER touch wallet/ledger.
 *   • Stake / pot — play-money credits, escrowed + settled by the CORE via the win/draw/void
 *     `Outcome`. This module works only in chips and never sees a credit.
 *
 * Hidden simultaneous betting: each player allocates their full stack, hidden from the opponent
 * until BOTH lock (no last-mover advantage — `viewFor` never transmits an allocation early). The
 * full-stack rule (sum of placed chips must equal CHIP_TOTAL before a lock) is the key mechanic
 * that forces real variance on a break-even wheel. Equal final stacks → internal replay (fresh
 * seed-derived spin, stacks reset), the same path as Blackjack/Mines; REPLAY_CAP → void + refund.
 *
 * A move is enumerable (the core validates moves against `legalMoves` by JSON-equality): chips
 * accrue in hidden state via incremental place/unplace/clear; `lock` is accepted only at a full
 * stack; `spread` (also the timeout auto-move) fills the remainder onto red/black and locks.
 */

/** The only moves. All are JSON-enumerable so they pass the core's legalMoves membership check. */
type RouletteMove =
  | { t: 'place'; bet: string; amount: number } // add `amount` chips to a bet
  | { t: 'unplace'; bet: string } // remove a bet's whole stack
  | { t: 'clear' } // remove all of my placements
  | { t: 'lock' } // freeze my allocation — REJECTED unless the full stack is placed
  | { t: 'spread' }; // auto-spread the remainder onto red/black + lock (timeout / auto path)

interface PlayerBet {
  /** betId → chips placed (only non-zero bets present). Hidden from the opponent until both lock. */
  allocation: Record<string, number>;
  /** Allocation frozen — no more betting; waiting for the opponent / resolution. */
  locked: boolean;
  /** Locked via the auto-spread path (timeout/disconnect or the explicit `spread` move). */
  autoSpread: boolean;
  /** Chip stack: CHIP_TOTAL while betting, the spin return after a round resolves. */
  stack: number;
}

/** A resolved round — public (both were locked), so it is shown to BOTH in `viewFor` and carried
 *  across an internal replay so a player can see the spin that just happened. */
interface RoundResult {
  round: number;
  pocket: number;
  /** Both players' revealed allocations for that round. */
  bets: Record<PlayerId, Record<string, number>>;
  stacks: Record<PlayerId, number>;
}

interface RouletteState {
  players: [PlayerId, PlayerId];
  /** Base seed (fixed at init); each round's pocket derives from it + the round index. */
  seed: number;
  round: number; // 0-based; bumped on a replay
  replays: number; // consecutive equal-stack replays so far
  bets: Record<PlayerId, PlayerBet>;
  /** The most recently resolved round (public). Present from the first spin onward. */
  lastResult?: RoundResult;
  winner?: PlayerId; // decisive (unequal) result → terminal
  forcedOutcome?: Outcome; // void (replay cap, or a forfeit tie) → terminal
}

function cast(state: GameState): RouletteState {
  return state as RouletteState;
}

function terminal(s: RouletteState): boolean {
  return s.winner !== undefined || s.forcedOutcome !== undefined;
}

function freshBet(): PlayerBet {
  return { allocation: {}, locked: false, autoSpread: false, stack: CHIP_TOTAL };
}

/** Chips already placed = sum of the allocation. Derived (no cache to drift). */
function placedOf(b: PlayerBet): number {
  let sum = 0;
  for (const v of Object.values(b.allocation)) sum += v;
  return sum;
}

const remainingOf = (b: PlayerBet): number => CHIP_TOTAL - placedOf(b);

function bothLocked(s: RouletteState): boolean {
  return s.players.every((p) => s.bets[p].locked);
}

/** Fill a player's unallocated remainder evenly across red/black, then mark the stack full.
 *  Deterministic: the remainder (always a multiple of CHIP_UNIT) splits red = ceil, black = floor
 *  of the units, so an odd remainder gives red the extra unit. Mutates `bet`. */
function autoSpread(bet: PlayerBet): void {
  const remainder = CHIP_TOTAL - placedOf(bet);
  if (remainder <= 0) return;
  const units = remainder / CHIP_UNIT;
  const redUnits = Math.ceil(units / 2);
  const blackUnits = units - redUnits;
  const [red, black] = AUTO_SPREAD_BETS;
  if (redUnits > 0) bet.allocation[red] = (bet.allocation[red] ?? 0) + redUnits * CHIP_UNIT;
  if (blackUnits > 0) bet.allocation[black] = (bet.allocation[black] ?? 0) + blackUnits * CHIP_UNIT;
}

/**
 * Once BOTH players are locked: reveal, spin the seeded pocket, score each stack, and either
 * decide the match (unequal → winner, terminal) or replay (equal → fresh round in the same escrow;
 * at REPLAY_CAP → void). Mutates `s`; returns the broadcast-safe events. Revealing both
 * allocations here is safe — a resolution can only happen with both locked.
 */
function resolve(s: RouletteState): GameEvent[] {
  if (!bothLocked(s) || terminal(s)) return [];
  const [p1, p2] = s.players;
  const pocket = pocketFor(s.seed, s.round);
  const st1 = scoreAllocation(s.bets[p1].allocation, pocket);
  const st2 = scoreAllocation(s.bets[p2].allocation, pocket);
  s.bets[p1].stack = st1;
  s.bets[p2].stack = st2;
  s.lastResult = {
    round: s.round,
    pocket,
    bets: { [p1]: { ...s.bets[p1].allocation }, [p2]: { ...s.bets[p2].allocation } },
    stacks: { [p1]: st1, [p2]: st2 },
  };
  const events: GameEvent[] = [{ type: 'round_resolved', payload: s.lastResult }];

  if (st1 !== st2) {
    s.winner = st1 > st2 ? p1 : p2;
    events.push({ type: 'match_decided', payload: { winner: s.winner } });
    return events;
  }

  // Equal stacks (incl. both-zero) → internal replay, not a contract-draw; void at the cap.
  s.replays += 1;
  if (s.replays >= REPLAY_CAP) {
    s.forcedOutcome = { type: 'void' };
    events.push({ type: 'match_voided', payload: { reason: 'replay_cap', replays: s.replays } });
    return events;
  }
  s.round += 1;
  s.bets = { [p1]: freshBet(), [p2]: freshBet() } as Record<PlayerId, PlayerBet>;
  events.push({ type: 'new_round', payload: { round: s.round, replays: s.replays } });
  return events;
}

const meta: GameMeta = {
  id: 'roulette',
  displayName: 'Roulette',
  minPlayers: 2,
  maxPlayers: 2,
  // Chance game (the wheel decides) — ranked by net winnings, like Coinflip/Mines.
  ranking: { kind: 'net_winnings' },
  bet: { minStake: 1, maxStake: 100, symmetricStake: true },
  averageDurationSec: 40,
  // Per-game rake (invariant #5); applied by the core on the decisive result only.
  rakeRate: 0.025,
  // The 30s betting window reuses the core's generic per-player move timer (#91): each player
  // gets one independent 30s clock (one move — the lock); on expiry the core injects `timeoutMove`
  // (→ `spread`) for them. A disconnect in betting is just a player whose clock expires →
  // auto-spread + proceed (the spec's "never void"), via the same generic path (no game branch).
  moveTimeoutMs: BETTING_TIMEOUT_MS,
};

export const rouletteModule: GameModule = {
  meta,

  init(players: PlayerId[], rng: Rng): GameState {
    const state: RouletteState = {
      players: [players[0], players[1]],
      // Fix the base seed here — every round's pocket (and replays, and the auto-spread path)
      // derives from it, so the whole match replays byte-identically (the contract's determinism).
      seed: rng.int(0, 0x7fffffff),
      round: 0,
      replays: 0,
      bets: { [players[0]]: freshBet(), [players[1]]: freshBet() } as Record<PlayerId, PlayerBet>,
    };
    return state;
  },

  legalMoves(state: GameState, playerId: PlayerId): Move[] {
    const s = cast(state);
    if (terminal(s)) return [];
    const me = s.bets[playerId];
    if (!me || me.locked) return []; // not in the match, or locked → waiting for the opponent
    const remaining = remainingOf(me);

    const moves: RouletteMove[] = [];
    for (const b of BETS) {
      const amounts = new Set<number>();
      for (const d of PLACE_DENOMS) if (d <= remaining) amounts.add(d);
      if (remaining > 0) amounts.add(remaining); // "all-in on this bet" (one-move max)
      for (const a of amounts) moves.push({ t: 'place', bet: b.id, amount: a });
    }
    for (const id of Object.keys(me.allocation)) moves.push({ t: 'unplace', bet: id });
    if (placedOf(me) > 0) moves.push({ t: 'clear' });
    if (remaining === 0) moves.push({ t: 'lock' }); // full-stack rule — lock only at exactly 0 left
    moves.push({ t: 'spread' }); // timeout/auto path (also a UI "auto-complete"); always legal while betting
    return moves;
  },

  applyMove(state: GameState, move: unknown, ctx: MoveContext): ApplyResult {
    const s = cast(state);
    const { playerId } = ctx;
    const cur = s.bets[playerId];
    if (terminal(s) || !cur || cur.locked) {
      throw new IllegalMove(`${playerId} cannot bet now`);
    }
    const m = move as RouletteMove;
    if (!m || typeof m !== 'object' || typeof (m as { t?: unknown }).t !== 'string') {
      throw new IllegalMove(`"${String(move)}" is not a valid roulette move`);
    }

    // Work on a copy (never mutate the input). Only the actor's bet changes pre-resolution.
    const next: RouletteState = {
      ...s,
      bets: {
        ...s.bets,
        [playerId]: { ...cur, allocation: { ...cur.allocation } },
      },
    };
    const me = next.bets[playerId];
    const events: GameEvent[] = [];

    switch (m.t) {
      case 'place': {
        const bet = betById(m.bet);
        if (!bet) throw new IllegalMove(`unknown bet "${m.bet}"`);
        if (!Number.isInteger(m.amount) || m.amount <= 0 || m.amount % CHIP_UNIT !== 0) {
          throw new IllegalMove(`amount ${m.amount} must be a positive multiple of ${CHIP_UNIT}`);
        }
        if (m.amount > remainingOf(me)) {
          throw new IllegalMove(`amount ${m.amount} exceeds remaining ${remainingOf(me)}`);
        }
        me.allocation[bet.id] = (me.allocation[bet.id] ?? 0) + m.amount;
        break;
      }
      case 'unplace': {
        if (!me.allocation[m.bet]) throw new IllegalMove(`nothing placed on "${m.bet}"`);
        delete me.allocation[m.bet];
        break;
      }
      case 'clear': {
        if (placedOf(me) === 0) throw new IllegalMove('nothing to clear');
        me.allocation = {};
        break;
      }
      case 'lock': {
        // The key mechanic — server-enforced full-stack rule. A lock is REJECTED unless the entire
        // stack is allocated; it is never optional.
        if (placedOf(me) !== CHIP_TOTAL) {
          throw new IllegalMove(`full stack (${CHIP_TOTAL}) must be allocated before lock (placed ${placedOf(me)})`);
        }
        me.locked = true;
        events.push({ type: 'player_locked', payload: { playerId } });
        break;
      }
      case 'spread': {
        // Auto-spread the remainder onto red/black and lock (timeout/disconnect, or a voluntary
        // auto-complete). Still honours the no-reserve principle — the full stack goes into play.
        autoSpread(me);
        me.locked = true;
        me.autoSpread = true;
        events.push({ type: 'player_locked', payload: { playerId, auto: true } });
        break;
      }
      default:
        throw new IllegalMove(`"${String((m as { t: unknown }).t)}" is not a roulette move`);
    }

    // A lock/spread that completes both players' locks triggers reveal + spin + resolve.
    events.push(...resolve(next));
    return { state: next, events };
  },

  isTerminal(state: GameState): boolean {
    return terminal(cast(state));
  },

  outcome(state: GameState): Outcome {
    const s = cast(state);
    if (s.forcedOutcome !== undefined) return s.forcedOutcome;
    // The only non-void terminal is a decisive winner (equal stacks replay, never terminate here).
    return { type: 'win', winner: s.winner! };
  },

  viewFor(state: GameState, playerId: PlayerId): GameState {
    const s = cast(state);
    const opponentId = s.players.find((p) => p !== playerId)!;

    // Terminal → full reveal (seed + both allocations + the final spin) for verifiability.
    if (terminal(s)) {
      return { ...s } as GameState;
    }

    // Betting: strip the seed (it would let a player compute the hidden pocket) and the opponent's
    // allocation (hidden until both lock — only their locked flag is shown). `lastResult` (a past,
    // already-resolved round) stays public. Own allocation is fully visible to its owner.
    const me = s.bets[playerId];
    const view: RouletteState = {
      players: s.players,
      seed: 0, // redacted (never the real seed pre-terminal)
      round: s.round,
      replays: s.replays,
      bets: {
        [playerId]: { allocation: { ...me.allocation }, locked: me.locked, autoSpread: me.autoSpread, stack: me.stack },
        [opponentId]: { allocation: {}, locked: s.bets[opponentId].locked, autoSpread: false, stack: CHIP_TOTAL },
      } as Record<PlayerId, PlayerBet>,
      ...(s.lastResult ? { lastResult: s.lastResult } : {}),
    };
    return view as GameState;
  },

  forfeit(state: GameState, _quitter: PlayerId): GameState {
    const s = cast(state);
    if (terminal(s)) return s;

    // Explicit abandon (NOT a disconnect — a per-player-timer game's socket close is handled by the
    // move-timer sweep, which auto-spreads + can replay; see gateway). Per spec, "auto-spread +
    // proceed; never void": auto-spread BOTH players' remainders, lock, and resolve THIS round to a
    // terminal result. An exact tie can't replay in a single terminal call → void (the lone edge).
    const next: RouletteState = {
      ...s,
      bets: Object.fromEntries(
        s.players.map((p) => [p, { ...s.bets[p], allocation: { ...s.bets[p].allocation } }]),
      ) as Record<PlayerId, PlayerBet>,
    };
    for (const p of next.players) {
      const b = next.bets[p];
      if (!b.locked) {
        autoSpread(b);
        b.locked = true;
        b.autoSpread = true;
      }
    }
    const [p1, p2] = next.players;
    const pocket = pocketFor(next.seed, next.round);
    const st1 = scoreAllocation(next.bets[p1].allocation, pocket);
    const st2 = scoreAllocation(next.bets[p2].allocation, pocket);
    next.bets[p1].stack = st1;
    next.bets[p2].stack = st2;
    next.lastResult = {
      round: next.round,
      pocket,
      bets: { [p1]: { ...next.bets[p1].allocation }, [p2]: { ...next.bets[p2].allocation } },
      stacks: { [p1]: st1, [p2]: st2 },
    };
    if (st1 === st2) next.forcedOutcome = { type: 'void' };
    else next.winner = st1 > st2 ? p1 : p2;
    return next;
  },

  /** Auto-move injected when a player's 30s betting clock expires (paired with meta.moveTimeoutMs):
   *  spread the unallocated remainder across red/black and lock. Deterministic — rng unused (the
   *  spread and the seeded pocket are both fixed) — but the signature supplies it. */
  timeoutMove(_state: GameState, _playerId: PlayerId, _rng: Rng): Move {
    return { t: 'spread' } satisfies RouletteMove;
  },
};

// Re-export the wheel constants/helpers for clients, the bot crowd, and tests.
export {
  AUTO_SPREAD_BETS,
  BETS,
  BETTING_TIMEOUT_MS,
  CHIP_TOTAL,
  CHIP_UNIT,
  PLACE_DENOMS,
  REPLAY_CAP,
  betById,
  isRed,
  pocketFor,
  scoreAllocation,
} from './wheel.js';
