import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId, Rng } from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';
import { diceModule as dice, rollFor, formatRoll, REPLAY_CAP, ROLL_RANGE } from './dice.js';

const A: PlayerId = 'alice';
const B: PlayerId = 'bob';

/** init draws two seeds (A then B) via rng.int — feed a fixed pair so the match is reproducible. */
const rngSeq = (seeds: number[]): Rng => { let i = 0; return { next: () => 0, int: () => seeds[i++] }; };
const reveal = (state: GameState, p: PlayerId) => dice.applyMove(state, 'reveal', { playerId: p, now: 0 });
const seedsOf = (s: GameState) => (s as { seeds: Record<string, number> }).seeds;

describe('dice.meta', () => {
  it('is a 2-player net_winnings chance game with 2.5% rake', () => {
    expect(dice.meta.id).toBe('dice');
    expect(dice.meta.ranking).toEqual({ kind: 'net_winnings' });
    expect(dice.meta.rakeRate).toBe(0.025);
    expect(dice.meta.bet.symmetricStake).toBe(true);
  });
});

describe('roll', () => {
  it('is in 0..9999 (= 0.00–99.99) and a pure function of (seed, round)', () => {
    for (let s = 1; s <= 50; s++) for (const r of [0, 1, 7]) {
      const v = rollFor(s, r);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(ROLL_RANGE);
      expect(rollFor(s, r)).toBe(v); // deterministic
    }
    expect(formatRoll(4237)).toBe('42.37');
    expect(formatRoll(5)).toBe('0.05');
  });
});

describe('init draws SEPARATE seeds', () => {
  it('records one seed per player (the independent-roll point)', () => {
    const s = dice.init([A, B], rngSeq([111, 222]));
    expect(seedsOf(s)).toEqual({ [A]: 111, [B]: 222 });
  });
});

describe('reveal + resolve', () => {
  it('legalMoves is [reveal] until you commit, then []', () => {
    const s = dice.init([A, B], rngSeq([111, 222]));
    expect(dice.legalMoves(s, A)).toEqual(['reveal']);
    const r = reveal(s, A);
    expect(dice.legalMoves(r.state, A)).toEqual([]); // A committed
    expect(dice.legalMoves(r.state, B)).toEqual(['reveal']); // B still pending
  });

  it('once BOTH reveal, the higher independent roll wins', () => {
    const s = dice.init([A, B], rngSeq([111, 222]));
    const expected = rollFor(111, 0) > rollFor(222, 0) ? A : B; // distinct seeds → decisive at round 0
    const r2 = reveal(reveal(s, A).state, B);
    expect(dice.isTerminal(r2.state)).toBe(true);
    expect(dice.outcome(r2.state)).toEqual({ type: 'win', winner: expected });
  });

  it('rejects a non-reveal move and a double-reveal', () => {
    const s = dice.init([A, B], rngSeq([1, 2]));
    expect(() => dice.applyMove(s, 'roll', { playerId: A, now: 0 })).toThrow(IllegalMove);
    const r = reveal(s, A);
    expect(() => reveal(r.state, A)).toThrow(IllegalMove);
  });

  it('an exact tie replays; identical seeds tie every round → void at the cap', () => {
    const s = dice.init([A, B], rngSeq([777, 777])); // same seed → identical roll every round
    const r2 = reveal(reveal(s, A).state, B);
    expect(dice.outcome(r2.state)).toEqual({ type: 'void' });
    expect((r2.state as { replays: number }).replays).toBe(REPLAY_CAP);
  });

  it('forfeit before resolution → void', () => {
    const s = dice.init([A, B], rngSeq([1, 2]));
    expect(dice.outcome(dice.forfeit(s, A))).toEqual({ type: 'void' });
  });
});

describe('viewFor — neither roll until the simultaneous reveal', () => {
  it('hides both seeds + rolls pre-terminal; reveals both at terminal', () => {
    const s = dice.init([A, B], rngSeq([111, 222]));
    const pre = reveal(s, A).state; // A revealed, B not → not terminal
    const v = dice.viewFor(pre, A) as Record<string, unknown>;
    expect(v.seeds).toEqual({}); // no seed leaks (would let a player precompute a roll)
    expect(v.result).toBeUndefined(); // no roll shown
    expect(v.revealed).toEqual({ [A]: true });

    const term = reveal(pre, B).state;
    const tv = dice.viewFor(term, A) as { seeds: Record<string, number>; result: { rolls: Record<string, number> } };
    expect(tv.seeds).toEqual({ [A]: 111, [B]: 222 }); // revealed for provably-fair
    expect(tv.result.rolls[A]).toBe(rollFor(111, 0));
    expect(tv.result.rolls[B]).toBe(rollFor(222, 0));
  });
});

describe('determinism', () => {
  it('same seeds + same reveals → identical rolls, winner, outcome', () => {
    const play = () => {
      const s = dice.init([A, B], rngSeq([4242, 1337]));
      const end = reveal(reveal(s, A).state, B).state;
      return { result: (end as { result: unknown }).result, outcome: dice.outcome(end) };
    };
    expect(play()).toEqual(play());
  });
});
