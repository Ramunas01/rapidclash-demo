import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Chessboard } from 'react-chessboard';
import type { Square } from 'react-chessboard/dist/chessboard/types';
import { Chess } from 'chess.js';
import { cn } from '@/lib/utils';
import { play, installUnlockOnFirstGesture } from '../lib/sound.js';
import { formatClock } from '../format.js';
import type { ChessView, ChessMove } from '../App.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

/** Board palette tuned to the lavender/purple design system (frame: white + light-purple). */
const LIGHT_SQUARE = '#ffffff';
const DARK_SQUARE = '#b0a3e6';
const LOW_TIME_MS = 10_000; // warn under ~10s (spec: "Client (display only)")

/** The standard chess opening position. The board is NEVER empty: with no live game the board falls
 *  back to this so idle/searching shows the starting position (white at the bottom, static). A live
 *  game overrides it with the server FEN; a finished game keeps its retained final FEN. */
const STANDARD_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

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

/**
 * The chess board (full-bleed) — never empty. Position is server-authoritative (perfect info, no
 * redaction); when there is no live game it falls back to the standard opening position so the hub
 * always shows pieces (idle/searching → starting preview; finished game → its retained final FEN).
 * Interaction (click + drag + promotion) is gated by the server-issued legalMoves, so it is
 * automatically STATIC in the preview and the frozen-final states (no moves → nothing draggable,
 * no selection, no hints). No on-board text — clocks live in the slot pills, the picker in the play
 * panel. The slot types legalMoves/onMove as string for the generic games — narrow them to ChessMove.
 */
function ChessBoard({ playerId, gameState, legalMoves, onMove }: GameAreaArgs) {
  const view = gameState as ChessView | null;
  const moves = legalMoves as unknown as ChessMove[];
  const move = onMove as unknown as (m: ChessMove) => void;

  const boardWidth = useBoardWidth();
  const [selected, setSelected] = useState<Square | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square } | null>(null);

  // FEN fallback → the board is never empty: no game → the opening position; live game → the live
  // position; finished game (gameState retained) → its final position.
  const fen = view?.fen ?? STANDARD_START_FEN;
  // Orientation: a present view → the player's colour (a live/finished game keeps the side it was
  // played on, flipping for black); no game → white at the player's bottom for the fresh preview.
  const isWhite = view && playerId ? view.players[0] === playerId : true;
  const orientation = isWhite ? 'white' : 'black';
  // Interactivity ONLY during a live game: no legalMoves (preview / frozen-final) → not my turn →
  // pieces static, click guards inert, no selection/hints. Nothing extra needed for the static states.
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

  // Move "thump": play when the server-authoritative position changes — covers BOTH players'
  // moves (fen updates on every server position change). Skip the first fen (initial mount /
  // re-mount with an unchanged position) so we don't thump on the opening board. Presentation
  // only — no game-logic/redaction impact.
  const prevFenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!fen) return;
    if (prevFenRef.current !== null && prevFenRef.current !== fen) play('move');
    prevFenRef.current = fen;
  }, [fen]);

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

/** The Chess game-area slot: ONE full-bleed board in every phase (never empty). Idle/searching →
 *  the starting-position preview; in-match → the live board; post-game → the frozen final. The
 *  board itself gates interactivity on legalMoves, so the preview and frozen states are static.
 *  The arena owns its surface (no grey table card). */
function ChessPanel(args: GameAreaArgs) {
  return <ChessBoard {...args} />;
}

/**
 * Chess Hub = the shared GameHub + a full-bleed chess board, with the dual cumulative clocks
 * migrated into the slot pills (opponent name + clock above, your name + clock below) via the
 * generic renderSlotAside mechanism, and the data-driven two-line time-control picker in the play
 * panel. Mechanic / WS flow / server-authoritative clock are unchanged — presentation only.
 */
export function ChessHubScreen(props: GameHubScreenProps) {
  // Unlock audio on the first user gesture (idempotent) — the demo's first sound is the chess
  // move thump, so this hub is an acceptable early mount point (App.tsx is off-limits here).
  useEffect(() => { installUnlockOnFirstGesture(); }, []);
  return <GameHub gameId="chess" gameName="Chess" renderGameArea={ChessPanel} renderSlotAside={ChessSlotAside} {...props} />;
}
