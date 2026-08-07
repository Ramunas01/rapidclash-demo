import { describe, it, expect } from 'vitest';
import type { GameState } from '@rapidclash/shared';
import { createGuestServices, selectBlackjackMove } from './index.js';

// Issue #297 (Owner's explicit heuristic spec): a probabilistic hit chance keyed to the hand's
// BEST value (soft ?? hard, i.e. `handValue`) — deliberately NOT a flat "stand on 17" rule.
//   ≤14 → 100%   15 → 90%   16 → 80%   17 → 50%   18 → 20%   ≥19 → 0%
// Sampled once per decision point (`random() < P(hit)`), same pluggable-`random()`-for-tests
// pattern as `selectChessMove`/`chess-bot-heuristic.test.ts`.

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
});

describe('createGuestServices().selectBotMove — Blackjack (issue #297 §4, the "thinking" delay)', () => {
  it('dispatches to the blackjack heuristic and picks a delay uniformly in the full 1-5s range', () => {
    const { selectBotMove } = createGuestServices();
    const delays: number[] = [];
    for (let i = 0; i < 100; i++) {
      const picked = selectBotMove('blackjack', stateWithBotHand(HAND_FOR_TOTAL[10]), BOT_ID, 1_000);
      expect(picked).toBeDefined();
      expect(picked!.move).toBe('hit'); // ≤14 → deterministic
      delays.push(picked!.delayMs);
    }
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(1_000);
      expect(d).toBeLessThan(5_000);
    }
    expect(Math.max(...delays) - Math.min(...delays)).toBeGreaterThan(1_000);
  });

  it('is undefined for any other game (mirrors the chess-only-today guard, generalized)', () => {
    const { selectBotMove } = createGuestServices();
    expect(selectBotMove('coinflip', stateWithBotHand(HAND_FOR_TOTAL[10]), BOT_ID, 1_000)).toBeUndefined();
  });
});
