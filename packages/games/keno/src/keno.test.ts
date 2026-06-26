import { describe, expect, it } from 'vitest';
import type { GameState, Move, PlayerId, Rng } from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';
import { kenoModule as keno } from './keno.js';
import { DRAW_COUNT, PICK_COUNT, POOL_SIZE, REPLAY_CAP, autofillPicks, countMatches, drawFor } from './draw.js';

const A = 'player-A';
const B = 'player-B';
const ctx = (playerId: string, now = 0) => ({ playerId, now });
const rngWith = (seed: number): Rng => ({ next: () => 0, int: () => seed });
const SEED = 4242;
const newGame = (seed = SEED): GameState => keno.init([A, B], rngWith(seed));

interface PicksV { picks: number[]; locked: boolean; autoFilled: boolean }
interface StateV {
  players: [PlayerId, PlayerId]; seed: number; round: number; replays: number;
  picks: Record<string, PicksV>;
  lastResult?: { round: number; draw: number[]; picks: Record<string, number[]>; matched: Record<string, number> };
  winner?: PlayerId; forcedOutcome?: { type: string };
}
const view = (s: GameState): StateV => s as StateV;
const apply = (s: GameState, p: string, m: Move): GameState => keno.applyMove(s, m, ctx(p)).state;
const pick = (s: GameState, p: string, n: number): GameState => apply(s, p, { t: 'pick', n });
const lock = (s: GameState, p: string): GameState => apply(s, p, { t: 'lock' });
const autofill = (s: GameState, p: string): GameState => apply(s, p, { t: 'autofill' });

/** Pick the given spots in order, then lock. */
function pickAndLock(s: GameState, p: string, spots: number[]): GameState {
  for (const n of spots) s = pick(s, p, n);
  return lock(s, p);
}
const nonDrawn = (draw: number[], count: number): number[] =>
  Array.from({ length: POOL_SIZE }, (_, i) => i + 1).filter((n) => !draw.includes(n)).slice(0, count);

describe('keno draw + auto-fill (deterministic fairness)', () => {
  it('draws DRAW_COUNT distinct numbers in 1..POOL_SIZE, deterministically', () => {
    const d = drawFor(SEED, 0);
    expect(d).toHaveLength(DRAW_COUNT);
    expect(new Set(d).size).toBe(DRAW_COUNT);
    expect(d.every((n) => n >= 1 && n <= POOL_SIZE)).toBe(true);
    expect(drawFor(SEED, 0)).toEqual(d); // pure
    expect(drawFor(SEED, 1)).not.toEqual(d); // each round independent
  });

  it('autofill completes to PICK_COUNT, skips existing, and is deterministic', () => {
    const a = autofillPicks(SEED, 0, 0, []);
    expect(a).toHaveLength(PICK_COUNT);
    expect(new Set(a).size).toBe(PICK_COUNT);
    expect(autofillPicks(SEED, 0, 0, [])).toEqual(a); // pure
    const withExisting = autofillPicks(SEED, 0, 0, [5, 6, 7]);
    expect(withExisting).toContain(5);
    expect(withExisting).toContain(6);
    expect(withExisting).toHaveLength(PICK_COUNT);
    // Different players draw different fills.
    expect(autofillPicks(SEED, 0, 1, [])).not.toEqual(a);
  });
});

describe('keno init + picking', () => {
  it('starts empty, not terminal', () => {
    const s = view(newGame());
    expect(s.round).toBe(0);
    expect(s.picks[A].picks).toEqual([]);
    expect(keno.isTerminal(newGame())).toBe(false);
  });

  it('legalMoves: pick + autofill while choosing; lock appears only at exactly PICK_COUNT', () => {
    let s = newGame();
    let lm = keno.legalMoves(s, A) as { t: string }[];
    expect(lm.some((m) => m.t === 'pick')).toBe(true);
    expect(lm.some((m) => m.t === 'autofill')).toBe(true);
    expect(lm.some((m) => m.t === 'lock')).toBe(false);
    for (let n = 1; n <= PICK_COUNT; n++) s = pick(s, A, n);
    lm = keno.legalMoves(s, A) as { t: string }[];
    expect(lm.some((m) => m.t === 'lock')).toBe(true);
    expect(lm.some((m) => m.t === 'pick')).toBe(false); // 8 chosen → no more picks
    expect(keno.legalMoves(lock(s, A), A)).toEqual([]); // locked → waiting
  });

  it('rejects an out-of-range / duplicate / over-count pick', () => {
    let s = newGame();
    expect(() => pick(s, A, 41)).toThrow(IllegalMove);
    s = pick(s, A, 5);
    expect(() => pick(s, A, 5)).toThrow(IllegalMove);
    for (let n = 1; n <= PICK_COUNT; n++) if (n !== 5) s = pick(s, A, n);
    expect(() => pick(s, A, 20)).toThrow(IllegalMove); // already 8
  });
});

describe('the exact-count lock rule', () => {
  it('REJECTS a lock unless exactly PICK_COUNT spots are chosen', () => {
    let s = newGame();
    expect(() => lock(s, A)).toThrow(IllegalMove); // 0
    for (let n = 1; n < PICK_COUNT; n++) s = pick(s, A, n);
    expect(() => lock(s, A)).toThrow(IllegalMove); // 7
    s = pick(s, A, PICK_COUNT);
    expect(() => lock(s, A)).not.toThrow(); // 8
  });
});

describe('resolution', () => {
  it('both lock → shared draw → more matches wins', () => {
    const draw = drawFor(SEED, 0);
    let s = newGame();
    s = pickAndLock(s, A, draw.slice(0, PICK_COUNT)); // 8 matches
    s = pickAndLock(s, B, nonDrawn(draw, PICK_COUNT)); // 0 matches
    expect(keno.isTerminal(s)).toBe(true);
    expect(keno.outcome(s)).toEqual({ type: 'win', winner: A });
    const v = view(s);
    expect(v.lastResult!.matched[A]).toBe(PICK_COUNT);
    expect(v.lastResult!.matched[B]).toBe(0);
    expect(v.lastResult!.draw).toEqual(draw);
  });

  it('is NOT terminal after only one player locks', () => {
    let s = newGame();
    s = pickAndLock(s, A, [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(keno.isTerminal(s)).toBe(false);
    expect(keno.legalMoves(s, A)).toEqual([]);
    expect((keno.legalMoves(s, B) as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('draws & internal replay', () => {
  it('equal matches → fresh round (not terminal)', () => {
    const draw = drawFor(SEED, 0);
    const same = draw.slice(0, PICK_COUNT);
    let s = newGame();
    s = pickAndLock(s, A, same);
    s = pickAndLock(s, B, same); // identical picks → identical matches → replay
    expect(keno.isTerminal(s)).toBe(false);
    const v = view(s);
    expect(v.round).toBe(1);
    expect(v.replays).toBe(1);
    expect(v.picks[A].picks).toEqual([]); // reset for the new round
    expect(v.lastResult!.round).toBe(0);
  });

  it('REPLAY_CAP consecutive ties → void + refund both', () => {
    let s = newGame();
    let guard = 0;
    while (!keno.isTerminal(s) && guard++ < REPLAY_CAP + 5) {
      const v = view(s);
      const same = drawFor(v.seed, v.round).slice(0, PICK_COUNT);
      s = pickAndLock(s, A, same);
      if (!keno.isTerminal(s)) s = pickAndLock(s, B, same);
    }
    expect(keno.outcome(s)).toEqual({ type: 'void' });
    expect(view(s).replays).toBe(REPLAY_CAP);
  });
});

describe('redaction (viewFor) — no peeking', () => {
  it("hides the opponent's picks and the seed while choosing", () => {
    let s = newGame();
    s = pick(s, A, 7);
    s = pick(s, A, 13);
    const bView = view(keno.viewFor(s, B));
    expect(bView.picks[A].picks).toEqual([]); // A's picks hidden
    expect(bView.seed).toBe(0); // seed stripped → B can't compute the draw
    expect(view(keno.viewFor(s, A)).picks[A].picks).toEqual([7, 13]); // own picks visible
  });

  it("keeps the opponent's picks hidden even after they lock (until both lock)", () => {
    let s = newGame();
    s = pickAndLock(s, A, [1, 2, 3, 4, 5, 6, 7, 8]);
    const bView = view(keno.viewFor(s, B));
    expect(bView.picks[A].locked).toBe(true);
    expect(bView.picks[A].picks).toEqual([]);
  });

  it('reveals both pick-sets + the draw + the seed at terminal', () => {
    const draw = drawFor(SEED, 0);
    let s = newGame();
    s = pickAndLock(s, A, draw.slice(0, PICK_COUNT));
    s = pickAndLock(s, B, nonDrawn(draw, PICK_COUNT));
    const bView = view(keno.viewFor(s, B));
    expect(bView.seed).toBe(SEED);
    expect(bView.picks[A].picks).toHaveLength(PICK_COUNT); // A's picks revealed
    expect(bView.lastResult!.draw).toEqual(draw);
  });
});

describe('determinism (required): one seed + recorded picks → identical result', () => {
  const playRound = (seed: number): GameState => {
    let s = keno.init([A, B], rngWith(seed));
    s = pickAndLock(s, A, [1, 2, 3, 4, 5, 6, 7, 8]);
    s = pickAndLock(s, B, [9, 10, 11, 12, 13, 14, 15, 16]);
    return s;
  };
  it('is byte-identical across two runs', () => {
    expect(playRound(987654)).toEqual(playRound(987654));
  });
  it('the auto-fill timeout path is deterministic too', () => {
    const run = (seed: number) => autofill(autofill(keno.init([A, B], rngWith(seed)), A), B);
    expect(view(run(321)).lastResult).toEqual(view(run(321)).lastResult);
  });
});

describe('timeout / auto-fill + forfeit', () => {
  it('timeoutMove returns autofill, which is legal while picking', () => {
    const s = newGame();
    expect(keno.timeoutMove!(s, A, rngWith(0))).toEqual({ t: 'autofill' });
    expect((keno.legalMoves(s, A) as { t: string }[]).some((m) => m.t === 'autofill')).toBe(true);
  });
  it('autofill completes a partial pick-set to PICK_COUNT and locks', () => {
    let s = newGame();
    s = pick(s, A, 3);
    s = autofill(s, A);
    const me = view(s).picks[A];
    expect(me.locked).toBe(true);
    expect(me.autoFilled).toBe(true);
    expect(me.picks).toContain(3);
    expect(me.picks).toHaveLength(PICK_COUNT);
  });
  it('forfeit auto-fills both and resolves to a terminal result', () => {
    let s = newGame();
    s = pickAndLock(s, A, drawFor(SEED, 0).slice(0, PICK_COUNT)); // A: 8 matches, locked
    s = keno.forfeit(s, B); // B auto-filled (8 random) → almost surely < 8 matches
    expect(keno.isTerminal(s)).toBe(true);
    // A had all 8 drawn numbers → A cannot lose; void only on an exact tie.
    const o = keno.outcome(s);
    expect(o.type === 'win' ? o.winner : 'void').toBe('player-A');
  });
});

describe('immutability', () => {
  it('applyMove never mutates the input state', () => {
    const s0 = newGame();
    const snap = JSON.stringify(s0);
    pick(s0, A, 9);
    expect(JSON.stringify(s0)).toBe(snap);
  });
  it('countMatches counts intersection', () => {
    expect(countMatches([1, 2, 3], [2, 3, 4])).toBe(2);
  });
});
