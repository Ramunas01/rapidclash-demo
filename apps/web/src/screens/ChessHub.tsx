import { useEffect, useMemo, useRef, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import type { Square } from 'react-chessboard/dist/chessboard/types';
import { Chess } from 'chess.js';
import { cn } from '@/lib/utils';
import { formatClock } from '../format.js';
import type { ChessView, ChessMove } from '../App.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

/** Board palette tuned to the lavender/purple design system. */
const LIGHT_SQUARE = '#d8cdf0';
const DARK_SQUARE = '#6b4bb0';
const LOW_TIME_MS = 10_000; // warn under ~10s (spec: "Client (display only)")

const PROMOTION_PIECES: { piece: 'q' | 'r' | 'b' | 'n'; label: string; glyph: string }[] = [
  { piece: 'q', label: 'Queen', glyph: '♛' },
  { piece: 'r', label: 'Rook', glyph: '♜' },
  { piece: 'b', label: 'Bishop', glyph: '♝' },
  { piece: 'n', label: 'Knight', glyph: '♞' },
];

/** Responsive board size — measured once and on resize. A fixed default keeps jsdom
 *  (offsetWidth 0) and SSR happy without react-chessboard's ResizeObserver path. */
function useBoardWidth(): number {
  const [w, setW] = useState(() => (typeof window !== 'undefined' ? Math.min(window.innerWidth - 48, 420) : 360));
  useEffect(() => {
    const onResize = () => setW(Math.min(window.innerWidth - 48, 420));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}

/**
 * Dual-clock display (display-only; the server is authoritative, invariant #2). Renders both
 * players' budgets from the view's PlayerClocks; the active player's clock ticks down locally
 * between server updates (re-synced whenever the server clock advances). Decides nothing.
 */
function ChessClocks({ clock, playerId, opponentId }: { clock: ChessView['clock']; playerId: string; opponentId: string }) {
  const [, setNow] = useState(() => Date.now());
  const active = clock?.active ?? null;
  const activeRemaining = active && clock ? clock.remainingMs[active] ?? 0 : 0;
  // Re-sync the local countdown whenever the server clock advances (active side or its budget).
  const sync = useRef({ at: Date.now(), remaining: activeRemaining, active });
  useEffect(() => {
    sync.current = { at: Date.now(), remaining: activeRemaining, active };
  }, [active, activeRemaining]);
  // Tick only while someone's clock is running.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active]);

  if (!clock) return null;
  const liveMs = (pid: string): number => {
    const banked = clock.remainingMs[pid] ?? 0;
    if (pid !== active) return banked; // paused → banked value
    return Math.max(0, sync.current.remaining - (Date.now() - sync.current.at));
  };

  const Row = ({ pid, label, testid }: { pid: string; label: string; testid: string }) => {
    const ms = liveMs(pid);
    const isActive = pid === active;
    const low = ms < LOW_TIME_MS;
    return (
      <div
        data-testid={testid}
        data-active={isActive}
        data-low-time={low}
        className={cn(
          'flex items-center justify-between rounded-lg px-3 py-1.5',
          isActive ? 'bg-brand/15 ring-1 ring-brand/40' : 'bg-surface',
        )}
      >
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <span
          className={cn(
            'flex items-center gap-1 text-sm font-bold tabular-nums',
            low ? 'text-destructive' : isActive ? 'text-foreground' : 'text-muted-foreground',
            low && isActive && 'animate-pulse',
          )}
        >
          {isActive && <span className={cn('h-1.5 w-1.5 rounded-full', low ? 'bg-destructive' : 'bg-success')} />}
          {formatClock(ms)}
        </span>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-2 gap-2" data-testid="chess-clocks">
      <Row pid={opponentId} label="Opponent" testid="chess-clock-opponent" />
      <Row pid={playerId} label="You" testid="chess-clock-self" />
    </div>
  );
}

/**
 * The live in-match chess board — ChessPlay's logic lifted into the GameHub slot: position is
 * server-authoritative (perfect info, no redaction), interaction (click + drag + promotion) is
 * gated by the server-issued legalMoves, and the dual clocks render from the view's PlayerClocks.
 * The slot types legalMoves/onMove as string for the generic games — narrow them back to ChessMove
 * (as MinesPanel narrows to numbers); the App's generic signature is unchanged.
 */
function ChessBoard({ playerId, opponentId, username, gameState, legalMoves, onMove, onForfeit }: GameAreaArgs) {
  const view = gameState as ChessView | null;
  // Chess moves are {from,to,promotion?} objects, not strings — narrow the generic slot types.
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
  const { inCheck, checkedKingSquare } = useMemo(() => {
    if (!fen) return { inCheck: false, checkedKingSquare: null as Square | null };
    try {
      const chess = new Chess(fen);
      if (!chess.inCheck()) return { inCheck: false, checkedKingSquare: null as Square | null };
      const turn = chess.turn();
      for (const row of chess.board()) {
        for (const sq of row) {
          if (sq && sq.type === 'k' && sq.color === turn) return { inCheck: true, checkedKingSquare: sq.square as Square };
        }
      }
      return { inCheck: true, checkedKingSquare: null as Square | null };
    } catch {
      return { inCheck: false, checkedKingSquare: null as Square | null };
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
    <div className="flex flex-col gap-3" data-testid="hub-board">
      {/* You / turn / check status */}
      <div className="flex items-center justify-between text-xs">
        <span data-testid="play-you" className="font-medium text-muted-foreground">
          {username ? <>You (<strong className="text-foreground">{username}</strong>)</> : 'You'}
          <span className="ml-1 text-foreground/40">· {isWhite ? 'White' : 'Black'}</span>
        </span>
        <span className="flex items-center gap-2">
          {inCheck && (
            <span data-testid="check-badge" className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 font-semibold text-destructive">
              Check!
            </span>
          )}
          <span data-testid="turn-indicator" className={cn('font-semibold', isMyTurn ? 'text-brand' : 'text-muted-foreground')}>
            {isMyTurn ? 'Your move' : "Opponent's move"}
          </span>
        </span>
      </div>

      {/* Dual clocks (cumulative budgets; the active one ticks). */}
      {view?.clock && playerId && opponentId && (
        <ChessClocks clock={view.clock} playerId={playerId} opponentId={opponentId} />
      )}

      {/* The board: server-authoritative position, moves gated by legalMoves. */}
      <div className="relative mx-auto" data-testid="chess-board" style={{ width: boardWidth }}>
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
            customBoardStyle={{ borderRadius: '0.75rem', boxShadow: '0 10px 30px rgba(0,0,0,0.45)' }}
            animationDuration={200}
          />
        ) : (
          <div className="aspect-square w-full animate-pulse rounded-xl border border-border bg-surface" />
        )}

        {pendingPromotion && (
          <div data-testid="promotion-picker" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/70 backdrop-blur-sm">
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

      <p className="text-center text-xs text-muted-foreground">Tap a piece, then a highlighted square. Your clock runs on your turn.</p>

      <button type="button" onClick={onForfeit} className="pt-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        Resign
      </button>
    </div>
  );
}

/** Greyed board preview shown in Idle/Waiting — the visual anchor before a match starts. */
function ChessIdle({ phase }: { phase: GameAreaArgs['phase'] }) {
  return (
    <div className="flex flex-col items-center gap-4 py-1">
      <div aria-hidden className="grid w-full max-w-[280px] grid-cols-8 overflow-hidden rounded-xl opacity-50">
        {Array.from({ length: 64 }, (_, i) => {
          const dark = (Math.floor(i / 8) + i) % 2 === 1;
          return <div key={i} className="aspect-square" style={{ backgroundColor: dark ? DARK_SQUARE : LIGHT_SQUARE }} />;
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {phase === 'waiting' ? 'Waiting for an opponent…' : 'Pick a bet + time control and press PLAY, or JOIN an open challenge'}
      </p>
    </div>
  );
}

/** The Chess game-area slot: greyed idle preview, or the live board + clocks in-match. */
function ChessPanel(args: GameAreaArgs) {
  return args.phase === 'in-match' ? <ChessBoard {...args} /> : <ChessIdle phase={args.phase} />;
}

/**
 * Chess Hub = the shared GameHub + a Chess play-panel (react-chessboard, legalMoves-gated
 * interaction, promotion picker, dual cumulative clocks). The generic GameHub renders the
 * data-driven time-control picker (from meta.timeControl) in the challenge-creation area, and
 * the feed rows show each challenge's control. Mechanic / WS flow / server-authoritative clock
 * are unchanged — this is the presentation client for the Parts 1/2 clock feature.
 */
export function ChessHubScreen(props: GameHubScreenProps) {
  return <GameHub gameId="chess" gameName="Chess" renderGameArea={ChessPanel} {...props} />;
}
