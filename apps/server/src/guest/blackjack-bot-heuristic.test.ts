import { describe, it, expect } from 'vitest';
import type { GameState } from '@rapidclash/shared';
import { createGuestServices } from './index.js';

// Issue #432 moved `selectBlackjackMove`/`hitProbability` (and their own unit tests, issue #297)
// into `packages/bot-heuristics` — see `packages/bot-heuristics/src/blackjack-bot-heuristic.test.ts`
// for the heuristic's own coverage. What stays here is guest mode's OWN wrapper policy:
// `createGuestServices().selectBotMove`'s game dispatch and its "thinking" delay (issue #297 §4).

const BOT_ID = 'demo-bot:blackjack:0';
const HUMAN_ID = 'guest:human';

/** A hand-constructed BlackjackState — the module's `legalMoves`/`applyMove` only ever read
 *  `hands[playerId]` and the terminal fields, so this is a faithful state without needing to drive
 *  it through `init` (whose decks are seed-derived and awkward to target at an exact hand value). */
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

/** Best value 10 — squarely in the ≤14 bucket, where P(hit) is 1, so the dispatch assertion below
 *  is deterministic rather than statistical. */
const SOFT_LOW_HAND = [c('10')];

describe('createGuestServices().selectBotMove — Blackjack (issue #297 §4, the "thinking" delay)', () => {
  it('dispatches to the blackjack heuristic and picks a delay uniformly in the full 1-5s range', () => {
    const { selectBotMove } = createGuestServices();
    const delays: number[] = [];
    for (let i = 0; i < 100; i++) {
      const picked = selectBotMove('blackjack', stateWithBotHand(SOFT_LOW_HAND), BOT_ID, 1_000);
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
    expect(selectBotMove('coinflip', stateWithBotHand(SOFT_LOW_HAND), BOT_ID, 1_000)).toBeUndefined();
  });
});
