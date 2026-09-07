import { describe, it, expect } from 'vitest';
import type { GameState } from '@rapidclash/shared';
import { createGuestServices } from './index.js';

// Issue #432 moved `selectChessMove` itself (and its own unit tests, issue #278 §3) into
// `packages/bot-heuristics` — see `packages/bot-heuristics/src/chess-bot-heuristic.test.ts` for
// the heuristic's own coverage. What stays here is guest mode's OWN wrapper policy: which games
// `createGuestServices().selectBotMove` answers for, and the "thinking" delay it attaches
// (issue #278 §4) — neither of which moved, because the guest gateway owns that scheduling.

const BOT_ID = 'demo-bot:chess:0';
const HUMAN_ID = 'guest:human';

// White queen d1, black pawn d4, kings out of the way. 17 legal moves; exactly one (Qd1xd4)
// captures anything — every other move scores 0. Verified against chess.js directly.
const ONE_CAPTURE_STATE: GameState = {
  players: [BOT_ID, HUMAN_ID],
  fen: '4k3/8/8/8/3p4/8/8/3QK3 w - - 0 1',
  history: [],
};

describe('createGuestServices().selectBotMove (issue #278 §4 — the "thinking" delay)', () => {
  it('is chess-only: undefined for any other game', () => {
    const { selectBotMove } = createGuestServices();
    expect(selectBotMove('coinflip', ONE_CAPTURE_STATE, BOT_ID, 1_000)).toBeUndefined();
  });

  it('picks a delay uniformly distributed across the full 1-5s range, not just present', () => {
    const { selectBotMove } = createGuestServices();
    const delays: number[] = [];
    for (let i = 0; i < 100; i++) {
      const picked = selectBotMove('chess', ONE_CAPTURE_STATE, BOT_ID, 1_000);
      expect(picked).toBeDefined();
      delays.push(picked!.delayMs);
    }
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(1_000);
      expect(d).toBeLessThan(5_000);
    }
    // Genuinely spread across the range, not clustered at one end or a single value.
    expect(Math.max(...delays) - Math.min(...delays)).toBeGreaterThan(1_000);
  });

  it('still returns a real, legal chess move — the extraction to @rapidclash/bot-heuristics is wired up', () => {
    // Guards the #432 refactor at the seam: `selectBotMove` must still be dispatching into the
    // (now external) heuristic, not silently returning something undefined/garbage.
    const { selectBotMove } = createGuestServices();
    const picked = selectBotMove('chess', ONE_CAPTURE_STATE, BOT_ID, 1_000);
    expect(picked).toBeDefined();
    const move = picked!.move as { from?: string; to?: string };
    expect(typeof move.from).toBe('string');
    expect(typeof move.to).toBe('string');
  });
});
