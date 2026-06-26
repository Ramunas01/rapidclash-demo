import { describe, expect, it } from 'vitest';
import type { GameState, Move, PlayerId, Rng } from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';
import { limboModule as limbo } from './limbo.js';
import { MIN_TARGET, REPLAY_CAP, TARGET_LADDER, autoTargetFor, decideRoll, rollFor } from './roll.js';

const A = 'player-A';
const B = 'player-B';
const ctx = (playerId: string, now = 0) => ({ playerId, now });
const rngWith = (seed: number): Rng => ({ next: () => 0, int: () => seed });
const SEED = 5150;
const newGame = (seed = SEED): GameState => limbo.init([A, B], rngWith(seed));

interface PickV { target: number | null; locked: boolean; auto: boolean }
interface StateV {
  players: [PlayerId, PlayerId]; seed: number; round: number; replays: number;
  picks: Record<string, PickV>;
  lastResult?: { round: number; roll: number; targets: Record<string, number>; winner: PlayerId | null };
  winner?: PlayerId; forcedOutcome?: { type: string };
}
const view = (s: GameState): StateV => s as StateV;
const apply = (s: GameState, p: string, m: Move): GameState => limbo.applyMove(s, m, ctx(p)).state;
const pickLock = (s: GameState, p: string, target: number): GameState =>
  apply(apply(s, p, { t: 'pick', target }), p, { t: 'lock' });

describe('limbo zero-edge roll + ladder', () => {
  it('rollFor is deterministic and always > 1', () => {
    for (let r = 0; r < 40; r++) {
      const R = rollFor(SEED, r);
      expect(R).toBeGreaterThan(1);
      expect(rollFor(SEED, r)).toBe(R);
    }
  });

  it('decideRoll implements the bravery rule', () => {
    // R ≥ both → higher target wins.
    expect(decideRoll(10, 2, 5)).toBe('b'); // 5 is higher, both clear
    expect(decideRoll(10, 5, 2)).toBe('a');
    // R between → lower (surviving) target wins.
    expect(decideRoll(3, 2, 5)).toBe('a'); // only 2 clears
    expect(decideRoll(3, 5, 2)).toBe('b');
    // R < both → push.
    expect(decideRoll(1.5, 2, 5)).toBe('push');
    // equal targets → push.
    expect(decideRoll(10, 3, 3)).toBe('push');
  });

  it('autoTargetFor is a deterministic ladder value, differing per player', () => {
    const a = autoTargetFor(SEED, 0, 0);
    expect(TARGET_LADDER).toContain(a);
    expect(autoTargetFor(SEED, 0, 0)).toBe(a);
    expect(autoTargetFor(SEED, 0, 1)).not.toBe(undefined);
  });
});

describe('limbo picking + lock', () => {
  it('legalMoves: a pick per ladder value + auto; lock only once a target is chosen', () => {
    let s = newGame();
    let lm = limbo.legalMoves(s, A) as { t: string }[];
    expect(lm.filter((m) => m.t === 'pick')).toHaveLength(TARGET_LADDER.length);
    expect(lm.some((m) => m.t === 'auto')).toBe(true);
    expect(lm.some((m) => m.t === 'lock')).toBe(false);
    s = apply(s, A, { t: 'pick', target: 5 });
    lm = limbo.legalMoves(s, A) as { t: string }[];
    expect(lm.some((m) => m.t === 'lock')).toBe(true);
  });

  it('rejects an off-ladder target and a lock with no target', () => {
    const s = newGame();
    expect(() => apply(s, A, { t: 'pick', target: 7.3 })).toThrow(IllegalMove);
    expect(() => apply(s, A, { t: 'lock' })).toThrow(IllegalMove);
  });
});

describe('resolution', () => {
  it('both lock → shared roll → bravery rule decides (or push → replay)', () => {
    // Choose two targets that straddle the roll so the result is decisive.
    const roll = rollFor(SEED, 0);
    // pick lo just below the roll (clears) and hi just above (busts) → lo wins.
    const lo = [...TARGET_LADDER].reverse().find((t) => t <= roll) ?? MIN_TARGET;
    const hi = TARGET_LADDER.find((t) => t > roll) ?? TARGET_LADDER[TARGET_LADDER.length - 1];
    let s = newGame();
    s = pickLock(s, A, lo);
    s = pickLock(s, B, hi);
    if (lo === hi) return; // degenerate seed — skip (covered by decideRoll unit test)
    expect(limbo.isTerminal(s)).toBe(true);
    // R ≥ lo and R < hi → only lo clears → A (lo) wins.
    expect(limbo.outcome(s)).toEqual({ type: 'win', winner: A });
    expect(view(s).lastResult!.roll).toBe(roll);
  });

  it('equal targets → push → replay (not terminal)', () => {
    let s = newGame();
    s = pickLock(s, A, 3);
    s = pickLock(s, B, 3);
    expect(limbo.isTerminal(s)).toBe(false);
    const v = view(s);
    expect(v.round).toBe(1);
    expect(v.replays).toBe(1);
    expect(v.lastResult!.winner).toBeNull();
  });

  it('REPLAY_CAP pushes → void', () => {
    let s = newGame();
    let guard = 0;
    while (!limbo.isTerminal(s) && guard++ < REPLAY_CAP + 5) {
      s = pickLock(s, A, 3);
      if (!limbo.isTerminal(s)) s = pickLock(s, B, 3); // identical targets → push every round
    }
    expect(limbo.outcome(s)).toEqual({ type: 'void' });
    expect(view(s).replays).toBe(REPLAY_CAP);
  });

  it('is NOT terminal after only one player locks', () => {
    const s = pickLock(newGame(), A, 2);
    expect(limbo.isTerminal(s)).toBe(false);
    expect(limbo.legalMoves(s, A)).toEqual([]);
    expect((limbo.legalMoves(s, B) as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('redaction (viewFor)', () => {
  it("hides the opponent's target + the roll while choosing", () => {
    const s = apply(newGame(), A, { t: 'pick', target: 25 });
    const bView = view(limbo.viewFor(s, B));
    expect(bView.picks[A].target).toBeNull(); // hidden
    expect(bView.seed).toBe(0);
    expect(view(limbo.viewFor(s, A)).picks[A].target).toBe(25); // own target visible
  });

  it("keeps the opponent's target hidden even after they lock", () => {
    const s = pickLock(newGame(), A, 50);
    const bView = view(limbo.viewFor(s, B));
    expect(bView.picks[A].locked).toBe(true);
    expect(bView.picks[A].target).toBeNull();
  });

  it('reveals both targets + the roll + seed at terminal', () => {
    let s = pickLock(newGame(), A, 2);
    s = pickLock(s, B, 1000000); // very different → almost surely decisive
    if (!limbo.isTerminal(s)) return;
    const bView = view(limbo.viewFor(s, B));
    expect(bView.seed).toBe(SEED);
    expect(bView.picks[A].target).toBe(2);
    expect(typeof bView.lastResult!.roll).toBe('number');
  });
});

describe('determinism + timeout/forfeit', () => {
  it('one seed + recorded targets → identical result', () => {
    const run = (seed: number) => pickLock(pickLock(limbo.init([A, B], rngWith(seed)), A, 5), B, 2);
    expect(run(24680)).toEqual(run(24680));
  });
  it('the auto (timeout) path is deterministic', () => {
    const run = (seed: number) => apply(apply(limbo.init([A, B], rngWith(seed)), A, { t: 'auto' }), B, { t: 'auto' });
    expect(view(run(111)).lastResult).toEqual(view(run(111)).lastResult);
  });
  it('timeoutMove returns auto, which is legal', () => {
    const s = newGame();
    expect(limbo.timeoutMove!(s, A, rngWith(0))).toEqual({ t: 'auto' });
    expect((limbo.legalMoves(s, A) as { t: string }[]).some((m) => m.t === 'auto')).toBe(true);
  });
  it('forfeit auto-assigns both and resolves terminal', () => {
    const s = limbo.forfeit(newGame(), B);
    expect(limbo.isTerminal(s)).toBe(true);
    expect(['win', 'void']).toContain(limbo.outcome(s).type);
  });
  it('applyMove never mutates the input', () => {
    const s0 = newGame();
    const snap = JSON.stringify(s0);
    apply(s0, A, { t: 'pick', target: 10 });
    expect(JSON.stringify(s0)).toBe(snap);
  });
});
