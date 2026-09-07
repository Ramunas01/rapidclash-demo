// Tests for the Chess/Blackjack move policies (issue #432) — the wiring that makes a bot-crowd bot
// pick a REASONED move from the shared `@rapidclash/bot-heuristics` implementation instead of a
// uniformly random legal one.
//
// `chessMove`/`blackjackMove` are exported from bot.ts as pure functions specifically so this file
// can exercise them without a live server/WS/HTTP connection — the same pattern `isTakeable` and
// `hasSufficientFunds` already established there.
//
// The heuristics' own statistical behaviour is covered in `packages/bot-heuristics`; what is under
// test HERE is the seam: that state flows in, that a real move comes out for chess/blackjack, and
// that a missing or unusable state degrades to `null` (so the caller's `??`-chain falls back to a
// random legal move) rather than throwing and wedging the bot mid-match.
import { describe, expect, it } from 'vitest';
import { blackjackMove, chessMove } from './bot.js';
import type { GameState } from '@rapidclash/shared';

const BOT_ID = 'bot-player-1';
const HUMAN_ID = 'human-player-2';

// White queen d1 can capture the black pawn on d4; 17 legal moves, exactly one captures. Same
// fixture the heuristics package's own tests use.
const CHESS_STATE: GameState = {
  players: [BOT_ID, HUMAN_ID],
  fen: '4k3/8/8/8/3p4/8/8/3QK3 w - - 0 1',
  history: [],
};

function blackjackState(cards: Array<{ rank: string; suit: string }>): GameState {
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

describe('chessMove — the bot-crowd seam onto @rapidclash/bot-heuristics', () => {
  it('returns a legal, well-formed chess move when the board state is present', () => {
    for (let i = 0; i < 20; i++) {
      const move = chessMove(CHESS_STATE, BOT_ID, 1_000) as { from: string; to: string };
      expect(move).not.toBeNull();
      expect(typeof move.from).toBe('string');
      expect(typeof move.to).toBe('string');
    }
  });

  it('actually plays the capture a substantial share of the time — NOT the old uniform random pick', () => {
    // The heuristic's 50/50 gate puts the sole capturing move at ~50%. A uniformly random choice
    // among 17 legal moves would land on it ~6% of the time. 300 trials separates those two
    // hypotheses far beyond any plausible sampling noise — this is the assertion that would fail
    // if the wiring silently fell back to `moves[Math.floor(Math.random() * moves.length)]`.
    // (The heuristic's own finer-grained statistics live in `packages/bot-heuristics`; 150 trials
    // is ample to separate ~50% from ~6% and keeps this suite's runtime down.)
    let captures = 0;
    const N = 150;
    for (let i = 0; i < N; i++) {
      const move = chessMove(CHESS_STATE, BOT_ID, 1_000) as { from: string; to: string };
      if (move.from === 'd1' && move.to === 'd4') captures++;
    }
    expect(captures / N).toBeGreaterThan(0.3);
    expect(captures / N).toBeLessThan(0.7);
  });

  it('returns null (not a throw) when no state has been received yet', () => {
    // The pre-#432 condition: a bot that has never stored a GameState. Must degrade to the random
    // fallback, never crash the handler.
    expect(chessMove(null, BOT_ID, 1_000)).toBeNull();
  });

  it("returns null when it isn't the bot's turn — the heuristic's own guard, caught not propagated", () => {
    const blackToMove: GameState = { ...(CHESS_STATE as object), fen: '4k3/8/8/8/3p4/8/8/3QK3 b - - 0 1' } as GameState;
    expect(chessMove(blackToMove, BOT_ID, 1_000)).toBeNull();
  });

  it('returns null on a malformed/unrecognizable state rather than throwing', () => {
    expect(chessMove({} as GameState, BOT_ID, 1_000)).toBeNull();
    expect(chessMove({ players: [BOT_ID, HUMAN_ID] } as GameState, BOT_ID, 1_000)).toBeNull();
  });
});

describe('blackjackMove — the bot-crowd seam onto @rapidclash/bot-heuristics', () => {
  it('always hits on a low hand (≤14 ⇒ P(hit)=1) — deterministic, and impossible under the old coin-flip', () => {
    // This is the headline fix: blackjack previously had NO strategy at all, choosing hit/stand
    // 50/50. On a hand of 10, a coin-flip would stand ~half the time; the heuristic never does.
    for (let i = 0; i < 100; i++) {
      expect(blackjackMove(blackjackState([{ rank: '10', suit: '♠' }]), BOT_ID)).toBe('hit');
    }
  });

  it('always stands on a strong hand (≥19 ⇒ P(hit)=0)', () => {
    const strong = [{ rank: '10', suit: '♠' }, { rank: '9', suit: '♥' }];
    for (let i = 0; i < 100; i++) {
      expect(blackjackMove(blackjackState(strong), BOT_ID)).toBe('stand');
    }
  });

  it('is genuinely probabilistic in the middle of the curve (17 ⇒ ~50%), not a hard rule', () => {
    const seventeen = [{ rank: '10', suit: '♠' }, { rank: '7', suit: '♥' }];
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(blackjackMove(blackjackState(seventeen), BOT_ID) as string);
    expect(seen).toEqual(new Set(['hit', 'stand']));
  });

  it('returns null (not a throw) when no state has been received yet', () => {
    expect(blackjackMove(null, BOT_ID)).toBeNull();
  });

  it('returns null when the bot has no legal move (hand already done)', () => {
    const done = {
      players: [BOT_ID, HUMAN_ID],
      seed: 1,
      round: 0,
      draws: 0,
      hands: {
        [BOT_ID]: { cards: [{ rank: '10', suit: '♠' }, { rank: '9', suit: '♥' }], done: true },
        [HUMAN_ID]: { cards: [{ rank: '9', suit: '♣' }, { rank: '2', suit: '♦' }], done: false },
      },
    } as unknown as GameState;
    expect(blackjackMove(done, BOT_ID)).toBeNull();
  });

  it('returns null on a malformed state rather than throwing', () => {
    expect(blackjackMove({} as GameState, BOT_ID)).toBeNull();
  });

  it('only ever returns a move blackjack actually accepts', () => {
    for (let i = 0; i < 50; i++) {
      const m = blackjackMove(blackjackState([{ rank: '10', suit: '♠' }, { rank: '6', suit: '♥' }]), BOT_ID);
      expect(['hit', 'stand']).toContain(m);
    }
  });
});
