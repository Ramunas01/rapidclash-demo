import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Chessboard } from 'react-chessboard';
import type { Square } from 'react-chessboard/dist/chessboard/types';
import { Chess } from 'chess.js';
import { cn } from '@/lib/utils';
import { formatClock } from '../format.js';
import type { ChessView, ChessMove } from '../App.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

/** Board palette tuned to the lavender/purple design system (frame: white + light-purple). */
const LIGHT_SQUARE = '#ffffff';
const DARK_SQUARE = '#b0a3e6';
const LOW_TIME_MS = 10_000; // warn under ~10s (spec: "Client (display only)")

const PROMOTION_PIECES: { piece: 'q' | 'r' | 'b' | 'n'; label: string; glyph: string }[] = [
  { piece: 'q', label: 'Queen', glyph: '♛' },
  { piece: 'r', label: 'Rook', glyph: '♜' },
  { piece: 'b', label: 'Bishop', glyph: '♝' },
  { piece: 'n', label: 'Knight', glyph: '♞' },
];

/** Full-bleed board width — the board spans the whole hub column (wider than the inset pills),
 *  capped at the max-w-md frame. A fixed default keeps jsdom (offsetWidth 0) / SSR happy. */
function useBoardWidth(): number {
  const measure = () => (typeof window !== 'undefined' ? Math.min(window.innerWidth, 448) : 360);
  const [w, setW] = useState(measure);
  useEffect(() => {
    const onResize = () => setW(measure());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}

/** Presentational clock chip rendered in a slot pill (display-only; the server is authoritative,
 *  invariant #2). The active side highlights; under ~10s it warns. */
function ClockPill({ ms, active, low, testid }: { ms: number; active: boolean; low: boolean; testid: string }) {
  return (
    <span
      data-testid={testid}
      data-active={active}
      data-low-time={low}
      className={cn(
        'flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-bold tabular-nums',
        active ? 'bg-brand/25 text-foreground ring-1 ring-brand/40' : 'bg-background/70 text-muted-foreground',
        low && 'text-destructive',
        low && active && 'animate-pulse',
      )}
    >
      {active && <span className={cn('h-1.5 w-1.5 rounded-full', low ? 'bg-destructive' : 'bg-success')} />}
      {formatClock(ms)}
    </span>
  );
}

/** Live single-player clock: the active player's budget ticks down locally between server updates
 *  (re-synced whenever the server clock advances); the paused side shows its banked value. */
function ChessClockChip({ clock, pid, testid }: { clock: NonNullable<ChessView['clock']>; pid: string; testid: string }) {
  const active = clock.active ?? null;
  const isActive = pid === active;
  const banked = clock.remainingMs[pid] ?? 0;
  const [, setTick] = useState(0);
  const sync = useRef({ at: Date.now(), remaining: banked });
  useEffect(() => { sync.current = { at: Date.now(), remaining: banked }; }, [banked, isActive]);
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [isActive]);
  const ms = isActive ? Math.max(0, sync.current.remaining - (Date.now() - sync.current.at)) : banked;
  return <ClockPill ms={ms} active={isActive} low={ms < LOW_TIME_MS} testid={testid} />;
}

/** Slot-pill aside for chess: each side's clock — live from the view in-match, or the selected
 *  control's base budget (e.g. 10:00) pre-match. Wired into both pills by the GameHub template. */
function ChessSlotAside(args: GameAreaArgs, side: 'opponent' | 'own'): ReactNode {
  const view = args.gameState as ChessView | null;
  const pid = side === 'own' ? args.playerId : args.opponentId;
  const testid = side === 'own' ? 'chess-clock-self' : 'chess-clock-opponent';
  if (view?.clock && pid) return <ChessClockChip clock={view.clock} pid={pid} testid={testid} />;
  if (args.timeControlBaseMs != null) return <ClockPill ms={args.timeControlBaseMs} active={false} low={false} testid={testid} />;
  return null;
}

/** Pre-game / searching board (owner decision): just the empty full-bleed board — no pieces, no
 *  table, no helper text. Real pieces render on match.start. */
function ChessEmptyBoard() {
  return (
    <div className="-mx-4" data-testid="chess-board">
      <div aria-hidden className="grid grid-cols-8">
        {Array.from({ length: 64 }, (_, i) => {
          const dark = (Math.floor(i / 8) + i) % 2 === 1;
          return <div key={i} className="aspect-square" style={{ backgroundColor: dark ? DARK_SQUARE : LIGHT_SQUARE }} />;
        })}
      </div>
    </div>
  );
}

/**
 * The live in-match chess board (full-bleed). Position is server-authoritative (perfect info, no
 * redaction); interaction (click + drag + promotion) is gated by the server-issued legalMoves.
 * No on-board text — clocks live in the slot pills, the picker in the play panel. The slot types
 * legalMoves/onMove as string for the generic games — narrow them back to ChessMove.
 */
function ChessBoard({ playerId, gameState, legalMoves, onMove }: GameAreaArgs) {
  const view = gameState as ChessView | null;
  const moves = legalMoves as unknown as ChessMove[];
  const move = onMove as unknown as (m: ChessMove) => void;

  const boardWidth = useBoardWidth();
  const [selected, setSelected] = useState<Square | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square } | null>(null);

  const fen = view?.fen ?? null;
  const isWhite = view && playerId ? view.players[0] === playerId : true;
  const orientation = isWhite ? 'white' : 'black';
  const isMyTurn = moves.length > 0;

  // chess.js is used ONLY for display facts derivable from the FEN (check + the king's square).
  const { checkedKingSquare } = useMemo(() => {
    if (!fen) return { checkedKingSquare: null as Square | null };
    try {
      const chess = new Chess(fen);
      if (!chess.inCheck()) return { checkedKingSquare: null as Square | null };
      const turn = chess.turn();
      for (const row of chess.board()) {
        for (const sq of row) {
          if (sq && sq.type === 'k' && sq.color === turn) return { checkedKingSquare: sq.square as Square };
        }
      }
      return { checkedKingSquare: null as Square | null };
    } catch {
      return { checkedKingSquare: null as Square | null };
    }
  }, [fen]);

  useEffect(() => {
    if (!isMyTurn) { setSelected(null); setPendingPromotion(null); }
  }, [isMyTurn]);

  const movesFrom = useMemo(() => {
    const map = new Map<string, ChessMove[]>();
    for (const m of moves) { const list = map.get(m.from) ?? []; list.push(m); map.set(m.from, list); }
    return map;
  }, [moves]);

  const targetsForSelected = useMemo(() => {
    if (!selected) return new Set<string>();
    return new Set((movesFrom.get(selected) ?? []).map((m) => m.to));
  }, [selected, movesFrom]);

  function attemptMove(from: Square, to: Square): boolean {
    const candidates = (movesFrom.get(from) ?? []).filter((m) => m.to === to);
    if (candidates.length === 0) return false;
    if (candidates.some((m) => m.promotion)) { setPendingPromotion({ from, to }); return true; }
    move(candidates[0]); setSelected(null); return true;
  }

  function handleSquareClick(square: Square) {
    if (!isMyTurn || pendingPromotion) return;
    if (selected && square !== selected && attemptMove(selected, square)) return;
    if (movesFrom.has(square)) setSelected(square); else setSelected(null);
  }

  function handlePieceDrop(from: Square, to: Square): boolean {
    if (!isMyTurn) return false;
    const candidates = (movesFrom.get(from) ?? []).filter((m) => m.to === to);
    if (candidates.length === 0) return false;
    if (candidates.some((m) => m.promotion)) { setSelected(from); setPendingPromotion({ from, to }); return false; }
    move(candidates[0]); setSelected(null); return true;
  }

  function choosePromotion(piece: 'q' | 'r' | 'b' | 'n') {
    if (!pendingPromotion) return;
    move({ from: pendingPromotion.from, to: pendingPromotion.to, promotion: piece });
    setPendingPromotion(null); setSelected(null);
  }

  const customSquareStyles = useMemo(() => {
    const styles: Record<string, Record<string, string>> = {};
    if (checkedKingSquare) styles[checkedKingSquare] = { background: 'radial-gradient(circle, rgba(239,68,68,0.7) 35%, transparent 75%)' };
    if (selected) styles[selected] = { ...styles[selected], background: 'rgba(139,61,255,0.45)' };
    for (const sq of targetsForSelected) {
      styles[sq] = { ...styles[sq], background: 'radial-gradient(circle, rgba(139,61,255,0.85) 22%, transparent 24%)', cursor: 'pointer' };
    }
    return styles;
  }, [checkedKingSquare, selected, targetsForSelected]);

  return (
    <div className="relative -mx-4" data-testid="chess-board" style={{ width: boardWidth }}>
      {fen ? (
        <Chessboard
          id="rapidclash-chess-hub"
          position={fen}
          boardWidth={boardWidth}
          boardOrientation={orientation}
          arePiecesDraggable={isMyTurn}
          onSquareClick={handleSquareClick}
          onPieceDrop={handlePieceDrop}
          customSquareStyles={customSquareStyles}
          customDarkSquareStyle={{ backgroundColor: DARK_SQUARE }}
          customLightSquareStyle={{ backgroundColor: LIGHT_SQUARE }}
          customBoardStyle={{ borderRadius: 0 }}
          animationDuration={200}
        />
      ) : (
        <div className="aspect-square w-full animate-pulse bg-surface" />
      )}

      {pendingPromotion && (
        <div data-testid="promotion-picker" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm">
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
  );
}

/** The Chess game-area slot: an empty full-bleed board pre-match, the live board in-match. The
 *  arena owns its surface (no grey table card). */
function ChessPanel(args: GameAreaArgs) {
  return args.phase === 'idle' || args.phase === 'waiting' ? <ChessEmptyBoard /> : <ChessBoard {...args} />;
}

/**
 * Chess Hub = the shared GameHub + a full-bleed chess board, with the dual cumulative clocks
 * migrated into the slot pills (opponent name + clock above, your name + clock below) via the
 * generic renderSlotAside mechanism, and the data-driven two-line time-control picker in the play
 * panel. Mechanic / WS flow / server-authoritative clock are unchanged — presentation only.
 */
export function ChessHubScreen(props: GameHubScreenProps) {
  return <GameHub gameId="chess" gameName="Chess" renderGameArea={ChessPanel} renderSlotAside={ChessSlotAside} {...props} />;
}
