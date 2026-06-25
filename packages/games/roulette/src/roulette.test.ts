import { describe, expect, it } from 'vitest';
import type { GameState, Move, PlayerId, Rng } from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';
import { rouletteModule as roulette } from './roulette.js';
import {
  BETS,
  CHIP_TOTAL,
  CHIP_UNIT,
  REPLAY_CAP,
  isRed,
  pocketFor,
  scoreAllocation,
} from './wheel.js';

const A = 'player-A';
const B = 'player-B';
const ctx = (playerId: string, now = 0) => ({ playerId, now });

// init calls rng.int(0, 0x7fffffff) once to fix the base seed.
const rngWith = (seed: number): Rng => ({ next: () => 0, int: () => seed });

// A view of the internal state for assertions (the module's state is opaque GameState).
interface BetV {
  allocation: Record<string, number>;
  locked: boolean;
  autoSpread: boolean;
  stack: number;
}
interface StateV {
  players: [PlayerId, PlayerId];
  seed: number;
  round: number;
  replays: number;
  bets: Record<string, BetV>;
  lastResult?: { round: number; pocket: number; bets: Record<string, Record<string, number>>; stacks: Record<string, number> };
  winner?: PlayerId;
  forcedOutcome?: { type: string };
}
const view = (s: GameState): StateV => s as StateV;

/** Apply a move and return the next state (threading through applyMove). */
const apply = (s: GameState, player: string, move: Move): GameState =>
  roulette.applyMove(s, move, ctx(player)).state;

const place = (s: GameState, player: string, bet: string, amount: number): GameState =>
  apply(s, player, { t: 'place', bet, amount });
const lock = (s: GameState, player: string): GameState => apply(s, player, { t: 'lock' });
const spread = (s: GameState, player: string): GameState => apply(s, player, { t: 'spread' });

/** Allocate the whole 1000 onto a single bet and lock. */
const allInLock = (s: GameState, player: string, bet: string): GameState =>
  lock(place(s, player, bet, CHIP_TOTAL), player);

const SEED = 777;
const newGame = (seed = SEED): GameState => roulette.init([A, B], rngWith(seed));

describe('roulette wheel — zeroless fairness (invariant #1)', () => {
  it('has 36 pockets, 18 red / 18 black, no zero', () => {
    const reds = Array.from({ length: 36 }, (_, i) => i + 1).filter(isRed);
    expect(reds.length).toBe(18);
    // 1..36 only; nothing covers 0.
    expect(isRed(0)).toBe(false);
  });

  it('every bet is break-even: coverage-fraction × payout === 1.00 (no house edge)', () => {
    for (const bet of BETS) {
      const covered = Array.from({ length: 36 }, (_, i) => i + 1).filter((p) => bet.covers(p)).length;
      // coverage/36 × mult must equal exactly 1 → expected return of 1.0 per chip.
      expect((covered / 36) * bet.mult).toBeCloseTo(1, 10);
    }
  });

  it('pocketFor is deterministic and always in 1..36', () => {
    for (let r = 0; r < 50; r++) {
      const p = pocketFor(SEED, r);
      expect(p).toBeGreaterThanOrEqual(1);
      expect(p).toBeLessThanOrEqual(36);
      expect(pocketFor(SEED, r)).toBe(p); // pure
    }
  });

  it('scoreAllocation pays total return on a covered bet, 0 otherwise', () => {
    // 1000 all on red: red hit → 2000, miss → 0.
    expect(scoreAllocation({ red: 1000 }, /*pocket*/ 1)).toBe(isRed(1) ? 2000 : 0);
    // Straight-up on the exact pocket pays 36×.
    expect(scoreAllocation({ s7: 10 }, 7)).toBe(360);
    expect(scoreAllocation({ s7: 10 }, 8)).toBe(0);
  });
});

describe('roulette init + betting', () => {
  it('credits 1000 chips each, enters betting, not terminal', () => {
    const s = view(newGame());
    expect(s.round).toBe(0);
    expect(s.replays).toBe(0);
    expect(s.bets[A].stack).toBe(CHIP_TOTAL);
    expect(s.bets[B].stack).toBe(CHIP_TOTAL);
    expect(s.bets[A].locked).toBe(false);
    expect(roulette.isTerminal(newGame())).toBe(false);
  });

  it('legalMoves offers place + spread while betting; lock appears only at a full stack', () => {
    const s0 = newGame();
    const lm0 = roulette.legalMoves(s0, A) as { t: string }[];
    expect(lm0.some((m) => m.t === 'place')).toBe(true);
    expect(lm0.some((m) => m.t === 'spread')).toBe(true);
    expect(lm0.some((m) => m.t === 'lock')).toBe(false); // nothing placed yet

    const s1 = place(s0, A, 'red', CHIP_TOTAL); // full stack
    const lm1 = roulette.legalMoves(s1, A) as { t: string }[];
    expect(lm1.some((m) => m.t === 'lock')).toBe(true);

    // A locked player has no legal moves.
    const s2 = lock(s1, A);
    expect(roulette.legalMoves(s2, A)).toEqual([]);
  });

  it('place rejects a non-CHIP_UNIT amount and an over-allocation', () => {
    const s = newGame();
    expect(() => place(s, A, 'red', 15)).toThrow(IllegalMove); // not a multiple of 10
    expect(() => place(s, A, 'red', 2000)).toThrow(IllegalMove); // exceeds remaining
    expect(() => place(s, A, 'not-a-bet', 10)).toThrow(IllegalMove);
  });

  it('unplace / clear free chips back up', () => {
    let s = place(newGame(), A, 'red', 500);
    s = place(s, A, 'black', 500);
    s = apply(s, A, { t: 'unplace', bet: 'red' });
    expect(view(s).bets[A].allocation).toEqual({ black: 500 });
    s = apply(s, A, { t: 'clear' });
    expect(view(s).bets[A].allocation).toEqual({});
  });
});

describe('the full-stack rule (the key mechanic — server-enforced)', () => {
  it('REJECTS a lock unless exactly 1000 is placed', () => {
    const s0 = newGame();
    expect(() => lock(s0, A)).toThrow(IllegalMove); // 0 placed
    const partial = place(s0, A, 'red', 990);
    expect(() => lock(partial, A)).toThrow(IllegalMove); // 990 placed
    const full = place(s0, A, 'red', CHIP_TOTAL);
    expect(() => lock(full, A)).not.toThrow(); // exactly 1000 → accepted
  });

  it('lock is NOT in legalMoves until the stack is full (cannot be bypassed via the core)', () => {
    const partial = place(newGame(), A, 'red', 500);
    const lm = roulette.legalMoves(partial, A) as { t: string }[];
    expect(lm.some((m) => m.t === 'lock')).toBe(false);
  });
});

describe('resolution + outcome', () => {
  it('both lock → one shared spin → higher stack wins (all-in on the winning colour)', () => {
    const pocket = pocketFor(SEED, 0);
    const winColour = isRed(pocket) ? 'red' : 'black';
    const loseColour = isRed(pocket) ? 'black' : 'red';
    let s = newGame();
    s = allInLock(s, A, winColour); // A wins (2000)
    s = allInLock(s, B, loseColour); // B busts (0)
    expect(roulette.isTerminal(s)).toBe(true);
    expect(roulette.outcome(s)).toEqual({ type: 'win', winner: A });
    const v = view(s);
    expect(v.bets[A].stack).toBe(2000);
    expect(v.bets[B].stack).toBe(0);
    expect(v.lastResult!.pocket).toBe(pocket);
  });

  it('is NOT terminal after only one player locks', () => {
    let s = newGame();
    s = allInLock(s, A, 'red');
    expect(roulette.isTerminal(s)).toBe(false);
    expect(roulette.legalMoves(s, A)).toEqual([]); // A waits
    expect((roulette.legalMoves(s, B) as unknown[]).length).toBeGreaterThan(0); // B still bets
  });
});

describe('draws & internal replay', () => {
  it('equal stacks → fresh round (stacks reset, not terminal), not a contract draw', () => {
    // Both all-in on the SAME colour → identical stacks → replay.
    const colour = isRed(pocketFor(SEED, 0)) ? 'red' : 'black';
    let s = newGame();
    s = allInLock(s, A, colour);
    s = allInLock(s, B, colour);
    expect(roulette.isTerminal(s)).toBe(false);
    const v = view(s);
    expect(v.round).toBe(1);
    expect(v.replays).toBe(1);
    expect(v.bets[A].stack).toBe(CHIP_TOTAL); // reset for the new round
    expect(v.bets[A].locked).toBe(false);
    expect(v.lastResult!.round).toBe(0); // the resolved round is shown
  });

  it('both bust to zero is also an equal-stack replay', () => {
    const pocket = pocketFor(SEED, 0);
    const loseColour = isRed(pocket) ? 'black' : 'red';
    let s = newGame();
    s = allInLock(s, A, loseColour);
    s = allInLock(s, B, loseColour); // both 0
    expect(roulette.isTerminal(s)).toBe(false);
    expect(view(s).replays).toBe(1);
  });

  it('REPLAY_CAP consecutive replays → void + refund both', () => {
    // Drive equal rounds until the cap. Each round both go all-in on that round's pocket colour
    // (identical allocations → equal stacks → replay) until replays hits the cap → void.
    let s = newGame();
    let guard = 0;
    while (!roulette.isTerminal(s) && guard++ < REPLAY_CAP + 5) {
      const v = view(s);
      const colour = isRed(pocketFor(v.seed, v.round)) ? 'red' : 'black';
      s = allInLock(s, A, colour);
      if (!roulette.isTerminal(s)) s = allInLock(s, B, colour);
    }
    expect(roulette.isTerminal(s)).toBe(true);
    expect(roulette.outcome(s)).toEqual({ type: 'void' });
    expect(view(s).replays).toBe(REPLAY_CAP);
  });
});

describe('redaction (viewFor) — no last-mover advantage', () => {
  it("hides the opponent's allocation and the seed while betting", () => {
    let s = newGame();
    s = place(s, A, 's7', 200);
    s = place(s, A, 'red', 800); // A fully placed but NOT locked
    const bView = view(roulette.viewFor(s, B)); // what B sees
    expect(bView.bets[A].allocation).toEqual({}); // A's bets hidden
    expect(bView.bets[A].locked).toBe(false);
    expect(bView.bets[B].allocation).toEqual({}); // B sees their own (empty so far)
    expect(bView.seed).toBe(0); // seed stripped → B cannot compute the pocket
    // A sees their OWN full allocation.
    const aView = view(roulette.viewFor(s, A));
    expect(aView.bets[A].allocation).toEqual({ s7: 200, red: 800 });
  });

  it("keeps the opponent's allocation hidden even AFTER they lock (until both lock)", () => {
    let s = newGame();
    s = allInLock(s, A, 'red'); // A locked, B still betting
    const bView = view(roulette.viewFor(s, B));
    expect(bView.bets[A].locked).toBe(true); // lock status is visible…
    expect(bView.bets[A].allocation).toEqual({}); // …but the allocation is NOT
    expect(bView.seed).toBe(0);
  });

  it('reveals both allocations + the seed at terminal', () => {
    const pocket = pocketFor(SEED, 0);
    const win = isRed(pocket) ? 'red' : 'black';
    const lose = isRed(pocket) ? 'black' : 'red';
    let s = newGame();
    s = allInLock(s, A, win);
    s = allInLock(s, B, lose); // decisive → terminal
    const bView = view(roulette.viewFor(s, B));
    expect(bView.bets[A].allocation).toEqual({ [win]: 1000 }); // A's bet now revealed to B
    expect(bView.seed).toBe(SEED); // revealed for verifiability
    expect(bView.lastResult!.pocket).toBe(pocket);
  });
});

describe('determinism (required): same seed + same locked allocations → identical result', () => {
  const playRound = (seed: number): GameState => {
    const pocket = pocketFor(seed, 0);
    const win = isRed(pocket) ? 'red' : 'black';
    const lose = isRed(pocket) ? 'black' : 'red';
    let s = roulette.init([A, B], rngWith(seed));
    s = allInLock(s, A, win);
    s = allInLock(s, B, lose);
    return s;
  };

  it('produces byte-identical state across two independent runs', () => {
    expect(playRound(424242)).toEqual(playRound(424242));
  });

  it('the auto-spread (timeout) path is deterministic too', () => {
    // A bets nothing and times out (spread); B bets nothing and times out (spread). Both get the
    // SAME 500/500 red/black auto-spread → equal stacks every round → identical across runs.
    const run = (seed: number): GameState => {
      let s = roulette.init([A, B], rngWith(seed));
      s = spread(s, A);
      s = spread(s, B);
      return s;
    };
    const r1 = run(99);
    const r2 = run(99);
    expect(r1).toEqual(r2);
    // Both auto-spread 500/500 → equal stacks → replay; the spread is recorded in the resolved
    // round (the current bets are already reset for the fresh round).
    const v = view(r1);
    expect(v.lastResult!.bets[A]).toEqual({ red: 500, black: 500 });
    expect(v.lastResult!.stacks[A]).toBe(v.lastResult!.stacks[B]); // equal → replay
    expect(v.replays).toBe(1);
  });
});

describe('timeout / disconnect (auto-spread) — never void; proceeds', () => {
  it('timeoutMove returns the spread move, which is legal while betting', () => {
    const s = newGame();
    const mv = roulette.timeoutMove!(s, A, rngWith(0)) as { t: string };
    expect(mv).toEqual({ t: 'spread' });
    const lm = roulette.legalMoves(s, A) as { t: string }[];
    expect(lm.some((m) => m.t === 'spread')).toBe(true);
  });

  it('spread fills the unallocated remainder onto red/black evenly and locks (full stack in play)', () => {
    let s = newGame();
    s = place(s, A, 's7', 100); // 900 remaining
    s = spread(s, A);
    const a = view(s).bets[A];
    expect(a.locked).toBe(true);
    expect(a.autoSpread).toBe(true);
    // 900 remainder → 450/450; s7 untouched; full stack now in play.
    expect(a.allocation).toEqual({ s7: 100, red: 450, black: 450 });
  });

  it('a player who never locks (disconnect) is auto-spread and the round still resolves — no void path here', () => {
    // A makes a real bet + locks; B never acts and is auto-spread (the sweep would inject `spread`).
    const pocket = pocketFor(SEED, 0);
    const win = isRed(pocket) ? 'red' : 'black';
    let s = newGame();
    s = allInLock(s, A, win); // A all-in on the winning colour (2000)
    s = spread(s, B); // B auto-spread 500/500 → exactly 1000 back (one colour wins)
    expect(roulette.isTerminal(s)).toBe(true); // 2000 vs 1000 → decisive, NOT void
    expect(roulette.outcome(s)).toEqual({ type: 'win', winner: A });
  });
});

describe('forfeit (explicit abandon) — auto-spread both, resolve terminal', () => {
  it('auto-spreads both unlocked players and resolves to a decisive winner', () => {
    const pocket = pocketFor(SEED, 0);
    const win = isRed(pocket) ? 'red' : 'black';
    let s = newGame();
    s = allInLock(s, A, win); // A all-in on the winner (2000)
    // B abandons without betting → forfeit auto-spreads B (500/500 → 1000). 2000 > 1000 → A wins.
    s = roulette.forfeit(s, B);
    expect(roulette.isTerminal(s)).toBe(true);
    expect(roulette.outcome(s)).toEqual({ type: 'win', winner: A });
  });

  it('a forfeit that ties → void (the lone void edge)', () => {
    // Neither player has bet; forfeit auto-spreads BOTH to 500/500 → equal stacks → void.
    const s = roulette.forfeit(newGame(), A);
    expect(roulette.isTerminal(s)).toBe(true);
    expect(roulette.outcome(s)).toEqual({ type: 'void' });
  });
});

describe('immutability + determinism guards', () => {
  it('applyMove never mutates the input state', () => {
    const s0 = newGame();
    const snapshot = JSON.stringify(s0);
    place(s0, A, 'red', 500);
    expect(JSON.stringify(s0)).toBe(snapshot);
  });

  it('CHIP_UNIT divides CHIP_TOTAL (100 placeable units)', () => {
    expect(CHIP_TOTAL % CHIP_UNIT).toBe(0);
    expect(CHIP_TOTAL / CHIP_UNIT).toBe(100);
  });
});
