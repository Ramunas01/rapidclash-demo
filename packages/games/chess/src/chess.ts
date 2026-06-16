import type {
  ApplyResult,
  GameModule,
  GameState,
  MoveContext,
  Outcome,
  PlayerId,
  Rng,
} from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';
import { Chess } from 'chess.js';

/** Standard chess starting position. `init` uses this and `forfeit` compares
 *  against it to tell "no move has been played yet" — the board can never
 *  legally return to the exact starting FEN, so equality is a sound test. */
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** A move in the JSON-serializable shape exchanged with the core/clients.
 *  `promotion` is the chess.js piece letter ('q' | 'r' | 'b' | 'n'). */
export interface ChessMove {
  from: string;
  to: string;
  promotion?: string;
}

/**
 * State is JSON-serializable: the whole game position lives in a single FEN
 * string. A fresh chess.js instance is reconstructed from it inside every
 * method (the instance is never stored).
 *
 * Note: threefold-repetition draws need move history, which a FEN alone does
 * not carry, so they are not auto-detected here. The other game-over states —
 * checkmate, stalemate, fifty-move (the halfmove clock lives in the FEN) and
 * insufficient material — are all decidable from the FEN and are detected.
 */
interface ChessState {
  /** players[0] = white, players[1] = black. */
  players: [PlayerId, PlayerId];
  /** Current position as a FEN string. */
  fen: string;
  /** Present only when the match ended via forfeit, bypassing normal play. */
  forcedOutcome?: Outcome;
}

function cast(state: GameState): ChessState {
  return state as ChessState;
}

/** The player whose side is to move per the FEN ('w' → white/players[0]). */
function sideToMovePlayer(s: ChessState): PlayerId {
  const chess = new Chess(s.fen);
  return chess.turn() === 'w' ? s.players[0] : s.players[1];
}

function isMoveObject(v: unknown): v is ChessMove {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as ChessMove).from === 'string' &&
    typeof (v as ChessMove).to === 'string'
  );
}

export const chessModule: GameModule = {
  meta: {
    id: 'chess',
    displayName: 'Chess',
    minPlayers: 2,
    maxPlayers: 2,
    // DECLARED ranking — the leaderboard does not compute elo yet (separate
    // issue); this is pending the Advisor's ranking decision.
    ranking: { kind: 'elo', k: 32 },
    bet: { minStake: 1, maxStake: 100, symmetricStake: true },
    averageDurationSec: 300,
  },

  init(players: PlayerId[], _rng: Rng): GameState {
    // rng unused: chess is fully deterministic from the move list.
    const state: ChessState = { players: [players[0], players[1]], fen: START_FEN };
    return state;
  },

  legalMoves(state: GameState, playerId: PlayerId): ChessMove[] {
    const s = cast(state);
    if (s.forcedOutcome !== undefined) return [];
    if (playerId !== sideToMovePlayer(s)) return [];
    const chess = new Chess(s.fen);
    if (chess.isGameOver()) return [];
    return chess.moves({ verbose: true }).map((m) => {
      const move: ChessMove = { from: m.from, to: m.to };
      if (m.promotion) move.promotion = m.promotion;
      return move;
    });
  },

  applyMove(state: GameState, move: unknown, ctx: MoveContext): ApplyResult {
    const s = cast(state);
    const { playerId } = ctx;
    if (s.forcedOutcome !== undefined) {
      throw new IllegalMove('the match has already ended');
    }
    if (playerId !== sideToMovePlayer(s)) {
      throw new IllegalMove(`it is not ${playerId}'s turn`);
    }
    if (typeof move !== 'string' && !isMoveObject(move)) {
      throw new IllegalMove(`"${JSON.stringify(move)}" is not a valid chess move`);
    }

    const chess = new Chess(s.fen);
    try {
      // chess.js validates legality and throws on an illegal move.
      chess.move(move as string | ChessMove);
    } catch {
      throw new IllegalMove(`"${JSON.stringify(move)}" is not a legal move in this position`);
    }

    const newState: ChessState = { ...s, fen: chess.fen() };
    return {
      state: newState,
      events: [{ type: 'move_made', payload: { playerId, move, fen: newState.fen } }],
    };
  },

  isTerminal(state: GameState): boolean {
    const s = cast(state);
    if (s.forcedOutcome !== undefined) return true;
    return new Chess(s.fen).isGameOver();
  },

  outcome(state: GameState): Outcome {
    const s = cast(state);
    if (s.forcedOutcome !== undefined) return s.forcedOutcome;
    const chess = new Chess(s.fen);
    if (chess.isCheckmate()) {
      // The side to move is the one that was mated; the mover (opposite side)
      // delivered mate and wins.
      const winner = chess.turn() === 'w' ? s.players[1] : s.players[0];
      return { type: 'win', winner };
    }
    // Stalemate, fifty-move, insufficient material (and threefold, if ever
    // reflected in the FEN) all resolve to a draw.
    return { type: 'draw' };
  },

  viewFor(state: GameState, _playerId: PlayerId): GameState {
    // Chess is perfect information — nothing to redact.
    return state;
  },

  forfeit(state: GameState, quitter: PlayerId): GameState {
    const s = cast(state);
    if (s.fen === START_FEN) {
      // Abandoned before the first move — refund both.
      return { ...s, forcedOutcome: { type: 'void' } };
    }
    const opponent = s.players.find((p) => p !== quitter) as PlayerId;
    return { ...s, forcedOutcome: { type: 'win', winner: opponent } };
  },
};
