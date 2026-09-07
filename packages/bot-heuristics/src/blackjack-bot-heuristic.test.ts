import { describe, it, expect } from 'vitest';
import type { GameState } from '@rapidclash/shared';
import { selectBlackjackMove, hitProbability } from './index.js';

// Issue #297 (Owner's explicit heuristic spec): a probabilistic hit chance keyed to the hand's
// BEST value (soft ?? hard, i.e. `handValue`) — deliberately NOT a flat "stand on 17" rule.
//   ≤14 → 100%   15 → 90%   16 → 80%   17 → 50%   18 → 20%   ≥19 → 0%
// Sampled once per decision point (`random() < P(hit)`), same pluggable-`random()`-for-tests
// pattern as `selectChessMove`/`chess-bot-heuristic.test.ts`.
//
// Ported verbatim from `apps/server/src/guest/blackjack-bot-heuristic.test.ts` by issue #432 (see
// chess-bot-heuristic.test.ts's header for the full rationale). Only the import path changed, plus
// a new direct-assertion block for `hitProbability`, which #432 promoted from file-private to
// exported.

function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
  };
}

const BOT_ID = 'demo-bot:blackjack:0';
const HUMAN_ID = 'guest:human';

/** A hand-constructed BlackjackState (mirrors how chess-bot-heuristic.test.ts hand-constructs a
 *  FEN state) — the module's `legalMoves`/`applyMove` only ever read `hands[playerId]` and the
 *  terminal fields, so this is a faithful state without needing to drive it through `init` (whose
 *  decks are seed-derived and awkward to target at an exact hand value). */
function stateWithBotHand(cards: Array<{ rank: string; suit: string }>): GameState {
  return {
    players: [BOT_ID, HUMAN_ID],
    seed: 1,
    round: 0,
    draws: 0,
    hands: {
      [BOT_ID]: { cards, done: false },
      [HUMAN_ID]: { cards: [{ rank: '9', suit: '♣' }, { rank: '2', suit: '♦' }], done: false },
    },
  } as unknown as GameState;
}

const c = (rank: string, suit = '♠') => ({ rank, suit });

// One hand per exact best-value threshold the table keys off. handValue's ace-downgrade means a
// hand with no ace is the simplest way to hit an exact total unambiguously.
const HAND_FOR_TOTAL: Record<number, Array<{ rank: string; suit: string }>> = {
  10: [c('10')], // ≤14 bucket (well under, not just at the boundary)
  14: [c('10'), c('4')], // ≤14 bucket, AT the boundary
  15: [c('10'), c('5')],
  16: [c('10'), c('6')],
  17: [c('10'), c('7')],
  18: [c('10'), c('8')],
  19: [c('10'), c('9')], // ≥19 bucket, AT the boundary
  21: [c('10'), c('10'), c('A')], // ≥19 bucket, well over — best=21 (ace downgraded to avoid bust)
};

describe("hitProbability (issue #297's table, exported by #432)", () => {
  it('matches the Owner-specified curve at and around every threshold', () => {
    expect(hitProbability(4)).toBe(1);
    expect(hitProbability(14)).toBe(1); // boundary of the ≤14 bucket
    expect(hitProbability(15)).toBe(0.9);
    expect(hitProbability(16)).toBe(0.8);
    expect(hitProbability(17)).toBe(0.5);
    expect(hitProbability(18)).toBe(0.2);
    expect(hitProbability(19)).toBe(0); // boundary of the ≥19 bucket
    expect(hitProbability(21)).toBe(0);
  });

  it('is monotonically non-increasing — a better hand is never MORE likely to hit', () => {
    for (let v = 5; v <= 21; v++) {
      expect(hitProbability(v)).toBeLessThanOrEqual(hitProbability(v - 1));
    }
  });

  it('is deliberately NOT a flat "stand on 17" step function', () => {
    // A stand-on-17 rule would be 1 below 17 and 0 at/above it. The three intermediate
    // probabilities are exactly what makes this an honest, fallible opponent.
    expect(hitProbability(15)).toBeGreaterThan(0);
    expect(hitProbability(15)).toBeLessThan(1);
    expect(hitProbability(17)).toBeGreaterThan(0);
    expect(hitProbability(17)).toBeLessThan(1);
    expect(hitProbability(18)).toBeGreaterThan(0);
    expect(hitProbability(18)).toBeLessThan(1);
  });
});

describe('selectBlackjackMove (issue #297)', () => {
  it('≤14 always hits (100%) — deterministic, not just likely', () => {
    for (const total of [10, 14]) {
      for (let i = 0; i < 30; i++) {
        expect(selectBlackjackMove(stateWithBotHand(HAND_FOR_TOTAL[total]), BOT_ID, seededRandom(i))).toBe('hit');
      }
    }
  });

  it('≥19 always stands (0%) — deterministic, not just likely', () => {
    for (const total of [19, 21]) {
      for (let i = 0; i < 30; i++) {
        expect(selectBlackjackMove(stateWithBotHand(HAND_FOR_TOTAL[total]), BOT_ID, seededRandom(i))).toBe('stand');
      }
    }
  });

  it.each([
    [15, 0.9],
    [16, 0.8],
    [17, 0.5],
    [18, 0.2],
  ])('best total %i hits at a rate statistically consistent with %i%%', (total, expected) => {
    const N = 500;
    let hits = 0;
    for (let i = 0; i < N; i++) {
      if (selectBlackjackMove(stateWithBotHand(HAND_FOR_TOTAL[total]), BOT_ID, seededRandom(i + total * 1000)) === 'hit') hits++;
    }
    const rate = hits / N;
    // Generous but discriminating band — distinguishes each threshold from its neighbours
    // (0.9/0.8/0.5/0.2 are all >0.1 apart) without asserting on an exact sample rate.
    expect(rate).toBeGreaterThan(expected - 0.1);
    expect(rate).toBeLessThan(expected + 0.1);
  });

  it('samples exactly once per call — a fixed random() sequence produces a fixed, reproducible sequence of decisions', () => {
    const random = seededRandom(42);
    const results: string[] = [];
    for (let i = 0; i < 10; i++) {
      results.push(selectBlackjackMove(stateWithBotHand(HAND_FOR_TOTAL[16]), BOT_ID, random));
    }
    const replay = seededRandom(42);
    const replayed: string[] = [];
    for (let i = 0; i < 10; i++) {
      replayed.push(selectBlackjackMove(stateWithBotHand(HAND_FOR_TOTAL[16]), BOT_ID, replay));
    }
    expect(replayed).toEqual(results);
    // Genuine variety across the 500-trial run above proves it isn't hardcoded to one branch —
    // sanity-check that this 10-trial sequence at 80% isn't monolithic either (would be
    // vanishingly unlikely at p=0.8 unless something were broken).
    expect(new Set(results).size).toBeGreaterThan(1);
  });

  it('throws if called for a bot with no legal move (mirrors selectChessMove\'s defensive guard)', () => {
    const doneState = {
      players: [BOT_ID, HUMAN_ID],
      seed: 1,
      round: 0,
      draws: 0,
      hands: {
        [BOT_ID]: { cards: [c('10'), c('9')], done: true },
        [HUMAN_ID]: { cards: [c('9'), c('2')], done: false },
      },
    } as unknown as GameState;
    expect(() => selectBlackjackMove(doneState, BOT_ID)).toThrow();
  });

  it('reads only the bot\'s OWN hand — the opponent\'s cards never influence the decision', () => {
    // The same bot hand under two wildly different opponent hands must produce identical decisions
    // for the same random sequence. This is what makes the function safe to run against the
    // `viewFor`-redacted state `tools/bot-crowd` receives off the wire (issue #432), where the
    // opponent's cards may be absent entirely.
    const weakOpp = stateWithBotHand(HAND_FOR_TOTAL[16]) as { hands: Record<string, unknown> };
    const strongOpp = stateWithBotHand(HAND_FOR_TOTAL[16]) as { hands: Record<string, unknown> };
    strongOpp.hands[HUMAN_ID] = { cards: [c('10'), c('A')], done: true };
    const a: string[] = [];
    const b: string[] = [];
    for (let i = 0; i < 50; i++) {
      a.push(selectBlackjackMove(weakOpp as GameState, BOT_ID, seededRandom(i)));
      b.push(selectBlackjackMove(strongOpp as GameState, BOT_ID, seededRandom(i)));
    }
    expect(b).toEqual(a);
  });
});
