// Tests for the per-game randomized "thinking" delay (issue #432), which replaced the single flat
// `BOT_MOVE_DELAY_MS`/700ms every game used to share — the one thing about the roster's behaviour
// that was structurally too-fast-to-be-human across the board.
//
// `MOVE_DELAY_RANGES`/`moveDelayRangeFor`/`moveDelayMsFor` are pure and read no env, so unlike the
// rest of config.ts's surface these need no `vi.resetModules()` env dance — a plain import is
// enough.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_DELAY_RANGE,
  MOVE_DELAY_RANGES,
  ROSTER,
  moveDelayMsFor,
  moveDelayRangeFor,
} from './config.js';

/** Deterministic stand-in for Math.random, so bounds are asserted exactly rather than sampled. */
function fixed(v: number): () => number {
  return () => v;
}

describe('MOVE_DELAY_RANGES — the table itself', () => {
  it('every range is well-formed (min < max, both positive)', () => {
    for (const [gameId, [min, max]] of Object.entries(MOVE_DELAY_RANGES)) {
      expect(min, gameId).toBeGreaterThan(0);
      expect(max, gameId).toBeGreaterThan(min);
    }
  });

  it('no game commits sub-second any more — the old flat 700ms is gone everywhere', () => {
    for (const [gameId, [min]] of Object.entries(MOVE_DELAY_RANGES)) {
      // 700ms was the old constant; every game's floor is now strictly above it.
      expect(min, gameId).toBeGreaterThan(700);
    }
    expect(DEFAULT_MOVE_DELAY_RANGE[0]).toBeGreaterThan(700);
  });

  it('covers every game the roster actually plays (no game silently falls back to the default)', () => {
    for (const bot of ROSTER) {
      expect(Object.keys(MOVE_DELAY_RANGES), bot.gameId).toContain(bot.gameId);
    }
  });

  it('stays clear of each game\'s real decision window, with headroom for latency', () => {
    // Upper bounds vs. the modules' own timers (see MOVE_DELAY_RANGES's doc comment for sources).
    // Asserting the ceiling is what stops a future "make it even more human" tune from pushing a
    // bot past its own timeout and forfeiting turns.
    const WINDOW_MS: Record<string, number> = {
      coinflip: 10_000, // coinflip.ts PICK_WINDOW_MS
      rps: 10_000, // rps.ts PICK_WINDOW_MS
      blackjack: 10_000, // blackjack.ts meta.moveTimeoutMs
      limbo: 10_000, // limbo/roll.ts PICK_TIMEOUT_MS
      mines: 5_000, // mines/board.ts MOVE_TIMEOUT_MS
      keno: 20_000, // keno/draw.ts PICK_TIMEOUT_MS
      roulette: 30_000, // roulette/wheel.ts BETTING_TIMEOUT_MS
      'ships-battle': 20_000, // fleet.ts SHOT_TIMEOUT_MS (the tighter of its two phases)
      crash: 3_000, // curve.ts CRASH_CONFIG.setupMs — the SETUP window, a HARD ceiling
      hilo: 30_000, // hilo/deck.ts MATCH_CAP_MS (whole-match cap, not per-move)
    };
    for (const [gameId, window] of Object.entries(WINDOW_MS)) {
      const [, max] = moveDelayRangeFor(gameId);
      // Never spend more than 70% of the window even at the top of the range.
      expect(max, gameId).toBeLessThanOrEqual(window * 0.7);
    }
  });

  it('roulette leaves room for BOTH of its moves (all-in place, then lock) inside one betting window', () => {
    const [, max] = moveDelayRangeFor('roulette');
    expect(max * 2).toBeLessThan(30_000); // BETTING_TIMEOUT_MS
  });

  it('crash pre-sets its auto-eject well inside SETUP — overshooting would break the bot, not just its cadence', () => {
    const [min, max] = moveDelayRangeFor('crash');
    expect(min).toBeGreaterThan(700);
    // Hard deadline is setupMs + ignitionMs = 4000ms; the SETUP boundary alone is 3000ms.
    expect(max).toBeLessThan(3_000);
  });

  it('hilo stays fast on purpose — a 30s whole-match race is the one place a long pause is LESS human', () => {
    const [, hiloMax] = moveDelayRangeFor('hilo');
    const [, coinflipMax] = moveDelayRangeFor('coinflip');
    expect(hiloMax).toBeLessThan(coinflipMax);
  });

  it('scales with the window: a 5s-window game is quicker than a 30s-window one', () => {
    expect(moveDelayRangeFor('mines')[1]).toBeLessThan(moveDelayRangeFor('roulette')[1]);
    expect(moveDelayRangeFor('mines')[1]).toBeLessThan(moveDelayRangeFor('coinflip')[1]);
  });
});

describe('moveDelayRangeFor — lookup', () => {
  it('returns the game\'s own range when it has one', () => {
    expect(moveDelayRangeFor('mines')).toEqual([1_000, 3_000]);
    expect(moveDelayRangeFor('blackjack')).toEqual([2_000, 6_000]);
  });

  it('falls back to DEFAULT_MOVE_DELAY_RANGE for an unknown game', () => {
    expect(moveDelayRangeFor('some-future-game')).toEqual(DEFAULT_MOVE_DELAY_RANGE);
    expect(moveDelayRangeFor('')).toEqual(DEFAULT_MOVE_DELAY_RANGE);
  });
});

describe('moveDelayMsFor — the randomized draw', () => {
  it('spans exactly [min, max) for every game in the table', () => {
    for (const gameId of Object.keys(MOVE_DELAY_RANGES)) {
      const [min, max] = moveDelayRangeFor(gameId);
      expect(moveDelayMsFor(gameId, fixed(0)), gameId).toBe(min); // bottom, inclusive
      expect(moveDelayMsFor(gameId, fixed(0.5)), gameId).toBe(min + (max - min) / 2);
      // random() is always < 1, so max is approached but never reached.
      expect(moveDelayMsFor(gameId, fixed(0.999999)), gameId).toBeLessThan(max);
    }
  });

  it('stays inside its bounds across many real (unseeded) draws', () => {
    for (const gameId of Object.keys(MOVE_DELAY_RANGES)) {
      const [min, max] = moveDelayRangeFor(gameId);
      for (let i = 0; i < 200; i++) {
        const d = moveDelayMsFor(gameId);
        expect(d, gameId).toBeGreaterThanOrEqual(min);
        expect(d, gameId).toBeLessThan(max);
      }
    }
  });

  it('is genuinely re-randomized per call, not a per-game constant', () => {
    const draws = new Set<number>();
    for (let i = 0; i < 100; i++) draws.add(moveDelayMsFor('blackjack'));
    expect(draws.size).toBeGreaterThan(50);
    // And actually spread across the range, not clustered at one end.
    const values = [...draws];
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(1_000);
  });

  it('two games with different windows really do get different cadences', () => {
    // Same random draw, different game ⇒ different delay. Guards against the helper accidentally
    // ignoring its gameId argument (which is exactly how the old flat constant behaved).
    expect(moveDelayMsFor('mines', fixed(0.5))).not.toBe(moveDelayMsFor('roulette', fixed(0.5)));
  });
});
