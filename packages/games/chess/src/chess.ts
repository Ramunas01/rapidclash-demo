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
 * State is JSON-serializable. The authoritative record of the game is the SAN
 * `history`; the `fen` is kept alongside it as a convenience (current position,
 * side-to-move). A fresh chess.js instance is reconstructed inside every method
 * (the instance is never stored).
 *
 * Threefold repetition needs the move history, which a FEN alone does not carry,
 * so the instance is rebuilt by replaying `history` into a fresh chess.js — that
 * populates its internal position counter so `isThreefoldRepetition()` works.
 * The other game-over states — checkmate, stalemate, fifty-move (halfmove clock
 * in the FEN) and insufficient material — are decidable from the FEN too, so a
 * state hydrated from a bare FEN (no history) still resolves all of them.
 */
interface ChessState {
  /** players[0] = white, players[1] = black. */
  players: [PlayerId, PlayerId];
  /** Current position as a FEN string (convenience / side-to-move). */
  fen: string;
  /** Moves played from the start, in SAN — the source of truth for replay. */
  history: string[];
  /** Present only when the match ended via forfeit, bypassing normal play. */
  forcedOutcome?: Outcome;
}

function cast(state: GameState): ChessState {
  return state as ChessState;
}

/**
 * Rebuild a chess.js instance for the current position. When a SAN `history` is
 * present it is replayed from the standard start so chess.js can see repetition;
 * otherwise (a state hydrated straight from a FEN) we fall back to the FEN, which
 * still decides every non-repetition terminal state.
 */
function reconstruct(s: ChessState): Chess {
  if (s.history && s.history.length > 0) {
    const chess = new Chess();
    for (const san of s.history) chess.move(san);
    return chess;
  }
  return new Chess(s.fen);
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
    const state: ChessState = { players: [players[0], players[1]], fen: START_FEN, history: [] };
    return state;
  },

  legalMoves(state: GameState, playerId: PlayerId): ChessMove[] {
    const s = cast(state);
    if (s.forcedOutcome !== undefined) return [];
    if (playerId !== sideToMovePlayer(s)) return [];
    const chess = reconstruct(s);
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

    // The FEN fully describes the current position, so a single move can be
    // validated and converted to SAN from it; the SAN is appended to `history`
    // so the full game can be replayed (and repetition seen) later.
    const chess = new Chess(s.fen);
    let san: string;
    try {
      // chess.js validates legality and throws on an illegal move.
      san = chess.move(move as string | ChessMove).san;
    } catch {
      throw new IllegalMove(`"${JSON.stringify(move)}" is not a legal move in this position`);
    }

    const newState: ChessState = {
      ...s,
      fen: chess.fen(),
      history: [...(s.history ?? []), san],
    };
    return {
      state: newState,
      events: [{ type: 'move_made', payload: { playerId, move, fen: newState.fen } }],
    };
  },

  isTerminal(state: GameState): boolean {
    const s = cast(state);
    if (s.forcedOutcome !== undefined) return true;
    // Replay the history so chess.js can also see threefold repetition.
    return reconstruct(s).isGameOver();
  },

  outcome(state: GameState): Outcome {
    const s = cast(state);
    if (s.forcedOutcome !== undefined) return s.forcedOutcome;
    const chess = reconstruct(s);
    if (chess.isCheckmate()) {
      // The side to move is the one that was mated; the mover (opposite side)
      // delivered mate and wins.
      const winner = chess.turn() === 'w' ? s.players[1] : s.players[0];
      return { type: 'win', winner };
    }
    // Stalemate, fifty-move, insufficient material and threefold repetition
    // all resolve to a draw.
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
