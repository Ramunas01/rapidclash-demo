import { useEffect, useMemo, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import type { Square } from 'react-chessboard/dist/chessboard/types';
import { Chess } from 'chess.js';
import { Crown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChessView, ChessMove } from '../App.js';

interface Props {
  playerId: string;
  /** The signed-in player's own alias (#34); null only on a legacy session pre-dating the field. */
  username: string | null;
  opponentId: string;
  gameState: ChessView | null;
  /** Server-issued legal moves (from/to/promotion). Empty unless it is this player's turn. */
  legalMoves: ChessMove[];
  onMove(move: ChessMove): void;
  onForfeit(): void;
}

/** Board palette tuned to the lavender/purple design system. */
const LIGHT_SQUARE = '#d8cdf0';
const DARK_SQUARE = '#6b4bb0';

const PROMOTION_PIECES: { piece: 'q' | 'r' | 'b' | 'n'; label: string; glyph: string }[] = [
  { piece: 'q', label: 'Queen', glyph: '♛' },
  { piece: 'r', label: 'Rook', glyph: '♜' },
  { piece: 'b', label: 'Bishop', glyph: '♝' },
  { piece: 'n', label: 'Knight', glyph: '♞' },
];

/** Responsive board size — measured once and on resize. A fixed default keeps jsdom
 *  (offsetWidth 0) and SSR happy without react-chessboard's ResizeObserver path. */
function useBoardWidth(): number {
  const [w, setW] = useState(() =>
    typeof window !== 'undefined' ? Math.min(window.innerWidth - 32, 440) : 360,
  );
  useEffect(() => {
    const onResize = () => setW(Math.min(window.innerWidth - 32, 440));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}

export function ChessPlayScreen({ playerId, username, gameState, legalMoves, onMove, onForfeit }: Props) {
  const boardWidth = useBoardWidth();
  const [selected, setSelected] = useState<Square | null>(null);
  // A from→to that needs a promotion piece chosen before it can be sent.
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square } | null>(null);

  const fen = gameState?.fen ?? null;
  // White is players[0] (chess module convention); orient the board to the viewer.
  const isWhite = gameState ? gameState.players[0] === playerId : true;
  const orientation = isWhite ? 'white' : 'black';
  const isMyTurn = legalMoves.length > 0;

  // chess.js is used ONLY for display facts derivable from the FEN (turn, check, the
  // king's square). Legal moves stay server-authoritative via `legalMoves`.
  const { inCheck, checkedKingSquare } = useMemo(() => {
    if (!fen) return { inCheck: false, checkedKingSquare: null as Square | null };
    try {
      const chess = new Chess(fen);
      if (!chess.inCheck()) return { inCheck: false, checkedKingSquare: null as Square | null };
      const turn = chess.turn();
      for (const row of chess.board()) {
        for (const sq of row) {
          if (sq && sq.type === 'k' && sq.color === turn) {
            return { inCheck: true, checkedKingSquare: sq.square as Square };
          }
        }
      }
      return { inCheck: true, checkedKingSquare: null as Square | null };
    } catch {
      return { inCheck: false, checkedKingSquare: null as Square | null };
    }
  }, [fen]);

  // Clear any in-progress selection whenever the turn ends (move sent / opponent's turn).
  useEffect(() => {
    if (!isMyTurn) {
      setSelected(null);
      setPendingPromotion(null);
    }
  }, [isMyTurn]);

  const movesFrom = useMemo(() => {
    const map = new Map<string, ChessMove[]>();
    for (const m of legalMoves) {
      const list = map.get(m.from) ?? [];
      list.push(m);
      map.set(m.from, list);
    }
    return map;
  }, [legalMoves]);

  const targetsForSelected = useMemo(() => {
    if (!selected) return new Set<string>();
    return new Set((movesFrom.get(selected) ?? []).map((m) => m.to));
  }, [selected, movesFrom]);

  /** Resolve a from→to to a concrete move; opens the promotion picker if the choice
   *  is ambiguous (same from/to, differing promotion piece). Returns true if a move
   *  was sent or a picker opened (i.e. the interaction was a legal one). */
  function attemptMove(from: Square, to: Square): boolean {
    const candidates = (movesFrom.get(from) ?? []).filter((m) => m.to === to);
    if (candidates.length === 0) return false;
    const needsPromotion = candidates.some((m) => m.promotion);
    if (needsPromotion) {
      setPendingPromotion({ from, to });
      return true;
    }
    onMove(candidates[0]);
    setSelected(null);
    return true;
  }

  function handleSquareClick(square: Square) {
    if (!isMyTurn || pendingPromotion) return;
    if (selected && square !== selected && attemptMove(selected, square)) return;
    // (Re)select a square that has at least one legal move; otherwise clear.
    if (movesFrom.has(square)) setSelected(square);
    else setSelected(null);
  }

  function handlePieceDrop(from: Square, to: Square): boolean {
    if (!isMyTurn) return false;
    const candidates = (movesFrom.get(from) ?? []).filter((m) => m.to === to);
    if (candidates.length === 0) return false;
    if (candidates.some((m) => m.promotion)) {
      // Let the explicit picker resolve the piece; snap the dragged pawn back meanwhile.
      setSelected(from);
      setPendingPromotion({ from, to });
      return false;
    }
    onMove(candidates[0]);
    setSelected(null);
    return true;
  }

  function choosePromotion(piece: 'q' | 'r' | 'b' | 'n') {
    if (!pendingPromotion) return;
    onMove({ from: pendingPromotion.from, to: pendingPromotion.to, promotion: piece });
    setPendingPromotion(null);
    setSelected(null);
  }

  const customSquareStyles = useMemo(() => {
    const styles: Record<string, Record<string, string>> = {};
    if (checkedKingSquare) {
      styles[checkedKingSquare] = { background: 'radial-gradient(circle, rgba(239,68,68,0.7) 35%, transparent 75%)' };
    }
    if (selected) {
      styles[selected] = { ...styles[selected], background: 'rgba(139,61,255,0.45)' };
    }
    for (const sq of targetsForSelected) {
      // Filled dot for quiet moves; ring for captures (a piece already sits on `to`).
      styles[sq] = {
        ...styles[sq],
        background:
          'radial-gradient(circle, rgba(139,61,255,0.85) 22%, transparent 24%)',
        cursor: 'pointer',
      };
    }
    return styles;
  }, [checkedKingSquare, selected, targetsForSelected]);

  const turnText = isMyTurn ? 'Your move' : "Opponent's move";

  return (
    <div className="flex min-h-screen flex-col bg-[#0b0e18] text-white">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-6">
        <h1 className="mb-2 flex items-center justify-center gap-2 text-xl font-bold">
          <Crown className="h-5 w-5 text-brand" />
          Chess
        </h1>

        {/* You / turn / check status */}
        <div className="mb-4 flex items-center justify-between text-xs">
          <span data-testid="play-you" className="font-medium text-white/60">
            {username ? <>You (<strong className="text-white">{username}</strong>)</> : 'You'}
            <span className="ml-1 text-white/30">· {isWhite ? 'White' : 'Black'}</span>
          </span>
          <span className="flex items-center gap-2">
            {inCheck && (
              <span
                data-testid="check-badge"
                className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 font-semibold text-red-300"
              >
                Check!
              </span>
            )}
            <span
              data-testid="turn-indicator"
              className={cn('font-semibold', isMyTurn ? 'text-brand' : 'text-white/50')}
            >
              {turnText}
            </span>
          </span>
        </div>

        {/* The board: position is server-authoritative (perfect info), moves gated by legalMoves. */}
        <div className="relative mx-auto" data-testid="chess-board" style={{ width: boardWidth }}>
          {fen ? (
            <Chessboard
              id="rapidclash-chess"
              position={fen}
              boardWidth={boardWidth}
              boardOrientation={orientation}
              arePiecesDraggable={isMyTurn}
              onSquareClick={handleSquareClick}
              onPieceDrop={handlePieceDrop}
              customSquareStyles={customSquareStyles}
              customDarkSquareStyle={{ backgroundColor: DARK_SQUARE }}
              customLightSquareStyle={{ backgroundColor: LIGHT_SQUARE }}
              customBoardStyle={{ borderRadius: '0.75rem', boxShadow: '0 10px 30px rgba(0,0,0,0.45)' }}
              animationDuration={200}
            />
          ) : (
            <div className="aspect-square w-full animate-pulse rounded-xl border border-white/10 bg-white/5" />
          )}

          {/* Promotion picker — shown when the chosen pawn push/capture reaches the back rank. */}
          {pendingPromotion && (
            <div
              data-testid="promotion-picker"
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/70 backdrop-blur-sm"
            >
              <p className="text-sm font-semibold text-white/80">Promote to…</p>
              <div className="flex gap-2">
                {PROMOTION_PIECES.map(({ piece, label, glyph }) => (
                  <button
                    key={piece}
                    type="button"
                    onClick={() => choosePromotion(piece)}
                    aria-label={`Promote to ${label}`}
                    data-testid={`promote-${piece}`}
                    className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/15 bg-white/[0.06] text-3xl text-white transition-colors hover:border-brand/60 hover:bg-white/[0.12] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    {glyph}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-white/40">
          Tap a piece, then a highlighted square. No clock — you have 120s per move.
        </p>

        <button
          type="button"
          onClick={onForfeit}
          className="mt-auto pt-6 text-sm font-medium text-white/40 transition-colors hover:text-white/70"
        >
          Resign
        </button>
      </div>
    </div>
  );
}
