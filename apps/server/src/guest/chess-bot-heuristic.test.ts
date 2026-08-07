import { describe, it, expect, vi } from 'vitest';
import { chessModule } from '@rapidclash/game-chess';
import type { GameState } from '@rapidclash/shared';
import { createGuestServices, selectChessMove } from './index.js';

// Issue #278 §3 (Owner's explicit heuristic spec): enumerate every legal move, score by captured
// piece value (0 if none), pick the best (ties broken uniformly), then a 50/50 gate between that
// move and a different random legal move — full evaluation always runs, before the gate.

// Seeded, deterministic — mirrors packages/core/src/matchmaking.ts's own mulberry32 so trials are
// reproducible, per the acceptance criteria's explicit ask for an injectable random source
// instead of asserting on real randomness.
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

const BOT_ID = 'demo-bot:chess:0';
const HUMAN_ID = 'guest:human';

// White queen d1, black pawn d4, kings out of the way. 17 legal moves; exactly one (Qd1xd4)
// captures anything — every other move scores 0. Verified against chess.js directly.
const ONE_CAPTURE_STATE: GameState = {
  players: [BOT_ID, HUMAN_ID],
  fen: '4k3/8/8/8/3p4/8/8/3QK3 w - - 0 1',
  history: [],
};
const CAPTURE_MOVE = { from: 'd1', to: 'd4' };

// White king a1 in check from a rook on b2 — Kxb2 is the ONLY legal move (verified against
// chess.js: `.moves()` returns exactly `['Kxb2']`).
const SOLE_LEGAL_MOVE_STATE: GameState = {
  players: [BOT_ID, HUMAN_ID],
  fen: '7k/8/8/8/8/8/1r6/K7 w - - 0 1',
  history: [],
};
const SOLE_MOVE = { from: 'a1', to: 'b2' };

describe('selectChessMove (issue #278 §3)', () => {
  it('plays the sole capturing move roughly half the time across repeated trials, and a different move the other half', () => {
    const N = 300;
    let captures = 0;
    for (let i = 0; i < N; i++) {
      const move = selectChessMove(ONE_CAPTURE_STATE, BOT_ID, 1_000, seededRandom(i + 1));
      if (move.from === CAPTURE_MOVE.from && move.to === CAPTURE_MOVE.to) captures++;
    }
    const rate = captures / N;
    // Statistically distinguishable from BOTH "always captures" (~1.0) and "always random, capture
    // excluded from the discard pool" (~0.0) — not asserting on an exact 50.0%, per the criterion.
    expect(rate).toBeGreaterThan(0.3);
    expect(rate).toBeLessThan(0.7);
  });

  it('the full capture-value evaluation runs every move, before the gate — even on a move the gate discards', () => {
    const legalCount = chessModule.legalMoves(ONE_CAPTURE_STATE, BOT_ID).length;
    const spy = vi.spyOn(chessModule, 'applyMove');
    try {
      for (let i = 0; i < 30; i++) {
        spy.mockClear();
        selectChessMove(ONE_CAPTURE_STATE, BOT_ID, 1_000, seededRandom(i + 500));
        // One speculative applyMove per candidate legal move, unconditionally — regardless of
        // which branch the 50/50 gate takes for THIS call.
        expect(spy).toHaveBeenCalledTimes(legalCount);
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('plays its only legal move regardless of the gate', () => {
    for (let i = 0; i < 20; i++) {
      const move = selectChessMove(SOLE_LEGAL_MOVE_STATE, BOT_ID, 1_000, seededRandom(i));
      expect(move).toEqual(SOLE_MOVE);
    }
  });

  it('ties for best score (including "nothing captures") are broken uniformly, not deterministically', () => {
    // Fresh starting position: no captures possible on move 1, every legal move scores 0 — a full
    // tie across all 20 legal moves.
    const start = chessModule.init([BOT_ID, HUMAN_ID], { next: () => 0.5, int: () => 0 });
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const move = selectChessMove(start, BOT_ID, 1_000, seededRandom(i + 900));
      seen.add(JSON.stringify(move));
    }
    // Real variety across trials — not the same move every time.
    expect(seen.size).toBeGreaterThan(3);
  });
});

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
});
