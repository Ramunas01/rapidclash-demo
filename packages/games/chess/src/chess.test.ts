import { describe, expect, it } from 'vitest';
import type { Rng } from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';
import { chessModule } from './chess.js';

const WHITE = 'player-white';
const BLACK = 'player-black';

// Chess uses no randomness; this stub satisfies the Rng interface.
const rng: Rng = { next: () => 0, int: () => 0 };

const ctx = (playerId: string) => ({ playerId, now: 0 });

type ChessMove = { from: string; to: string; promotion?: string };
type ChessView = {
  players: [string, string];
  fen: string;
  history?: string[];
  forcedOutcome?: unknown;
};
function view(state: unknown): ChessView {
  return state as ChessView;
}

/** Apply a list of moves alternately starting from a fresh game. */
function play(moves: ChessMove[]) {
  let state = chessModule.init([WHITE, BLACK], rng);
  for (const m of moves) {
    const player = view(state).fen.split(' ')[1] === 'w' ? WHITE : BLACK;
    state = chessModule.applyMove(state, m, ctx(player)).state;
  }
  return state;
}

// Fool's mate: 1. f3 e5 2. g4 Qh4# — fastest checkmate, delivered by Black.
const FOOLS_MATE: ChessMove[] = [
  { from: 'f2', to: 'f3' },
  { from: 'e7', to: 'e5' },
  { from: 'g2', to: 'g4' },
  { from: 'd8', to: 'h4' },
];

describe('chessModule.meta', () => {
  it('has the exact declared meta', () => {
    expect(chessModule.meta).toEqual({
      id: 'chess',
      displayName: 'Chess',
      minPlayers: 2,
      maxPlayers: 2,
      ranking: { kind: 'elo', k: 32 },
      bet: { minStake: 1, maxStake: 100, symmetricStake: true },
      averageDurationSec: 300,
      rakeRate: 0.1,
    });
  });

  it('declares a 10% rake rate', () => {
    expect(chessModule.meta.rakeRate).toBe(0.1);
  });
});

describe('chessModule.init', () => {
  it('starts white to move at the standard starting position', () => {
    const state = chessModule.init([WHITE, BLACK], rng);
    expect(view(state).players).toEqual([WHITE, BLACK]);
    expect(view(state).fen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  });

  it('produces JSON-serializable state', () => {
    const state = chessModule.init([WHITE, BLACK], rng);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe('chessModule.legalMoves', () => {
  it('returns 20 legal moves for white in the opening position', () => {
    const state = chessModule.init([WHITE, BLACK], rng);
    const moves = chessModule.legalMoves(state, WHITE);
    expect(moves).toHaveLength(20);
    // Each move is a serializable {from, to} shape.
    for (const m of moves) {
      expect(typeof m.from).toBe('string');
      expect(typeof m.to).toBe('string');
    }
  });

  it('returns [] for the player whose turn it is not', () => {
    const state = chessModule.init([WHITE, BLACK], rng);
    expect(chessModule.legalMoves(state, BLACK)).toEqual([]);
  });

  it('returns [] in a terminal (checkmate) position', () => {
    const state = play(FOOLS_MATE);
    expect(chessModule.legalMoves(state, WHITE)).toEqual([]);
    expect(chessModule.legalMoves(state, BLACK)).toEqual([]);
  });
});

describe('chessModule.applyMove', () => {
  it('advances the position and emits move_made', () => {
    const state = chessModule.init([WHITE, BLACK], rng);
    const { state: next, events } = chessModule.applyMove(
      state,
      { from: 'e2', to: 'e4' },
      ctx(WHITE)
    );
    expect(view(next).fen).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('move_made');
    expect((events[0].payload as { playerId: string }).playerId).toBe(WHITE);
  });

  it('accepts SAN strings as moves', () => {
    const state = chessModule.init([WHITE, BLACK], rng);
    const { state: next } = chessModule.applyMove(state, 'e4', ctx(WHITE));
    expect(view(next).fen).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
  });

  it('rejects an illegal move with IllegalMove', () => {
    const state = chessModule.init([WHITE, BLACK], rng);
    // A pawn cannot jump three squares.
    expect(() => chessModule.applyMove(state, { from: 'e2', to: 'e5' }, ctx(WHITE))).toThrow(
      IllegalMove
    );
  });

  it('rejects a move made out of turn with IllegalMove', () => {
    const state = chessModule.init([WHITE, BLACK], rng);
    // Black tries to move on white's turn.
    expect(() => chessModule.applyMove(state, { from: 'e7', to: 'e5' }, ctx(BLACK))).toThrow(
      IllegalMove
    );
  });

  it('rejects a structurally invalid move with IllegalMove', () => {
    const state = chessModule.init([WHITE, BLACK], rng);
    expect(() => chessModule.applyMove(state, 42, ctx(WHITE))).toThrow(IllegalMove);
  });

  it('does not mutate the input state', () => {
    const state = chessModule.init([WHITE, BLACK], rng);
    const before = JSON.stringify(state);
    chessModule.applyMove(state, { from: 'e2', to: 'e4' }, ctx(WHITE));
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('chessModule.isTerminal / outcome — checkmate', () => {
  it("fool's mate is terminal and Black (the mating side) wins", () => {
    const state = play(FOOLS_MATE);
    expect(chessModule.isTerminal(state)).toBe(true);
    expect(chessModule.outcome(state)).toEqual({ type: 'win', winner: BLACK });
  });

  it('is not terminal mid-game', () => {
    const state = play(FOOLS_MATE.slice(0, 2));
    expect(chessModule.isTerminal(state)).toBe(false);
  });
});

describe('chessModule.outcome — draws', () => {
  it('stalemate resolves to a draw', () => {
    // Black to move, king on h8 stalemated by Qf7 + Kg6. Not in check, no moves.
    const state = { players: [WHITE, BLACK], fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' };
    expect(chessModule.isTerminal(state)).toBe(true);
    expect(chessModule.outcome(state)).toEqual({ type: 'draw' });
  });

  it('insufficient material (K vs K) resolves to a draw', () => {
    const state = { players: [WHITE, BLACK], fen: '8/8/8/4k3/8/4K3/8/8 w - - 0 1' };
    expect(chessModule.isTerminal(state)).toBe(true);
    expect(chessModule.outcome(state)).toEqual({ type: 'draw' });
  });

  it('the fifty-move rule (halfmove clock 100) resolves to a draw', () => {
    const state = { players: [WHITE, BLACK], fen: '4k3/8/8/8/8/8/7R/4K3 w - - 100 1' };
    expect(chessModule.isTerminal(state)).toBe(true);
    expect(chessModule.outcome(state)).toEqual({ type: 'draw' });
  });
});

describe('chessModule.outcome — threefold repetition', () => {
  // Shuffle both knights out and back: g1-f3-g1 / g8-f6-g8, twice. Each full
  // cycle returns to the starting position, so after two cycles the start
  // position has occurred three times → threefold repetition.
  const KNIGHT_CYCLE: ChessMove[] = [
    { from: 'g1', to: 'f3' },
    { from: 'g8', to: 'f6' },
    { from: 'f3', to: 'g1' },
    { from: 'f6', to: 'g8' },
  ];
  const THREEFOLD: ChessMove[] = [...KNIGHT_CYCLE, ...KNIGHT_CYCLE];

  it('stores the move history as a SAN list (needed for replay)', () => {
    const state = play(KNIGHT_CYCLE);
    expect(view(state).history).toEqual(['Nf3', 'Nf6', 'Ng1', 'Ng8']);
  });

  it('a position repeated three times is terminal and a draw', () => {
    const state = play(THREEFOLD);
    expect(chessModule.isTerminal(state)).toBe(true);
    expect(chessModule.outcome(state)).toEqual({ type: 'draw' });
    // No moves are offered once the game is drawn.
    expect(chessModule.legalMoves(state, WHITE)).toEqual([]);
  });

  it('a position seen only twice is NOT falsely flagged as terminal', () => {
    // 7 plies in: every repeated position has occurred at most twice, so the
    // game is still live (Black is on move and has legal replies).
    const state = play(THREEFOLD.slice(0, 7));
    expect(chessModule.isTerminal(state)).toBe(false);
    expect(chessModule.legalMoves(state, BLACK).length).toBeGreaterThan(0);
  });

  it('replaying the same threefold move list reaches an identical terminal state', () => {
    const r1 = play(THREEFOLD);
    const r2 = play(THREEFOLD);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(chessModule.isTerminal(r1)).toBe(true);
    expect(chessModule.isTerminal(r2)).toBe(true);
    expect(chessModule.outcome(r1)).toEqual(chessModule.outcome(r2));
  });
});

describe('chessModule.viewFor', () => {
  it('returns the full state unchanged (perfect information)', () => {
    const state = play(FOOLS_MATE.slice(0, 2));
    expect(chessModule.viewFor(state, WHITE)).toBe(state);
    expect(chessModule.viewFor(state, BLACK)).toEqual(state);
  });
});

describe('chessModule.forfeit', () => {
  it('voids the match when a player quits before the first move', () => {
    const state = chessModule.init([WHITE, BLACK], rng);
    const terminal = chessModule.forfeit(state, WHITE);
    expect(chessModule.isTerminal(terminal)).toBe(true);
    expect(chessModule.outcome(terminal)).toEqual({ type: 'void' });
  });

  it('awards the win to the remaining player when quitting mid-game', () => {
    const state = play(FOOLS_MATE.slice(0, 1)); // one move played
    const terminal = chessModule.forfeit(state, WHITE);
    expect(chessModule.isTerminal(terminal)).toBe(true);
    expect(chessModule.outcome(terminal)).toEqual({ type: 'win', winner: BLACK });
  });

  it('the mover loses if they are the one who quits mid-game', () => {
    const state = play(FOOLS_MATE.slice(0, 1));
    const terminal = chessModule.forfeit(state, BLACK);
    expect(chessModule.outcome(terminal)).toEqual({ type: 'win', winner: WHITE });
  });
});

describe('chessModule — determinism', () => {
  it('replaying the same move list reaches an identical final FEN and outcome', () => {
    const r1 = play(FOOLS_MATE);
    const r2 = play(FOOLS_MATE);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(chessModule.outcome(r1)).toEqual(chessModule.outcome(r2));
  });

  it('a longer game replays to a byte-identical state', () => {
    const moves: ChessMove[] = [
      { from: 'e2', to: 'e4' },
      { from: 'c7', to: 'c5' },
      { from: 'g1', to: 'f3' },
      { from: 'd7', to: 'd6' },
      { from: 'd2', to: 'd4' },
      { from: 'c5', to: 'd4' },
      { from: 'f3', to: 'd4' },
      { from: 'g8', to: 'f6' },
      { from: 'b1', to: 'c3' },
    ];
    expect(view(play(moves)).fen).toBe(view(play(moves)).fen);
  });
});
