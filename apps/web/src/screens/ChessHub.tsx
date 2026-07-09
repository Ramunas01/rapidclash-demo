import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Chessboard } from 'react-chessboard';
import type { Square } from 'react-chessboard/dist/chessboard/types';
import { Chess } from 'chess.js';
import type { Outcome } from '@rapidclash/shared';
import { cn } from '@/lib/utils';
import { play, installUnlockOnFirstGesture } from '../lib/sound.js';
import { formatClock } from '../format.js';
import type { ChessView, ChessMove } from '../App.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';
import { outlineForOutcome, outlineClasses, useDelayedFlag } from './hub-shared/slotReveal.js';

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

/** The amber "Draw offered" indicator (CHESS_DRAW_OFFER.md). It renders on the OFFERING player's
 *  bar, keyed off the public `drawOffers` view state, so it shows on BOTH screens next to that
 *  player's name (the offerer sees it on their own bar; the opponent sees it on the offerer's).
 *  Reuses the existing draw hue (amber-400 — `slotReveal.tsx:48`). Not pressable; the action is the
 *  Draw request ⇄ Revoke DRAW button. */
function DrawOfferedChip({ side }: { side: 'opponent' | 'own' }) {
  return (
    <span
      data-testid={side === 'own' ? 'chess-draw-offered-self' : 'chess-draw-offered-opponent'}
      className="flex items-center gap-1 rounded-md bg-amber-400/15 px-2 py-1 text-[11px] font-black uppercase tracking-wide text-amber-400 ring-1 ring-amber-400/40"
    >
      <span aria-hidden="true">½</span>Draw offered
    </span>
  );
}

/** Slot-pill aside for chess: an optional "Draw offered" indicator + each side's clock — live from
 *  the view in-match, or the selected control's base budget (e.g. 10:00) pre-match. Wired into both
 *  pills by the GameHub template. */
function ChessSlotAside(args: GameAreaArgs, side: 'opponent' | 'own'): ReactNode {
  const view = args.gameState as ChessView | null;
  const pid = side === 'own' ? args.playerId : args.opponentId;
  const testid = side === 'own' ? 'chess-clock-self' : 'chess-clock-opponent';
  const offered = Boolean(args.phase === 'in-match' && pid && view?.drawOffers?.[pid]);
  const clock =
    view?.clock && pid ? (
      <ChessClockChip clock={view.clock} pid={pid} testid={testid} />
    ) : args.timeControlBaseMs != null ? (
      <ClockPill ms={args.timeControlBaseMs} active={false} low={false} testid={testid} />
    ) : null;
  if (!offered) return clock;
  return (
    <>
      <DrawOfferedChip side={side} />
      {clock}
    </>
  );
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

// ── Lightweight chess result popup (replaces the shared heavy overlay) ─────────────────────────
// Chess opts OUT of GameHub's ResultOverlay (suppressResultOverlay) — no blur, no confetti, no
// wallet/balance/trophy/X, board behind stays sharp. Instead a small native navy panel (same
// surface as the play panel) fades in over the frozen board with ONE line + the outcome outline,
// then auto-dismisses on its own animation. The lasting indicator is the own bar outline
// (ownBarResult) — this popup is the transient announcement. Timing is chess-specific: 6.0 s total.
//
// All outcomes: 0.5 s in → … → 0.5 s out, 6.0 s end to end (absolute-offset timers, so fake-timer
// tests fire reliably). Win is the two-phase bar pattern applied to the panel: it fills GREEN for the
// first beat, then the green fades back to navy leaving the "You Won" text + green outline.
const POPUP_IN_S = 0.5;
const POPUP_OUT_S = 0.5;
const POPUP_TOTAL_MS = 6000; // fully gone (unmount) at 6.0 s
const POPUP_FADE_OUT_AT_MS = 5500; // start the 0.5 s fade-out → gone at 6000
const WIN_FILL_FADE_AT_MS = 3000; // in (500) + green hold (2500) → green fill fades to navy
const WIN_FILL_GONE_AT_MS = 3500; // green fade (500) complete → unmount the fill layer

/** The one-line result text: Win → "You Won"; Loss → "[opponent] Won"; Draw → "Draw". Driven
 *  strictly by the server outcome + this player's id (never a client-side winner recompute). */
function chessResultLine(verdict: 'win' | 'lose' | 'draw', opponentName?: string | null): string {
  if (verdict === 'win') return 'You Won';
  if (verdict === 'draw') return 'Draw';
  return `${opponentName || 'Opponent'} Won`;
}

function ChessResultPopup({ outcome, playerId, opponentName }: { outcome: Outcome; playerId: string | null; opponentName?: string | null }) {
  const verdict = outlineForOutcome(outcome, playerId); // win | lose | draw | null (void → no popup)
  const gone = useDelayedFlag(true, POPUP_TOTAL_MS);
  const fadingOut = useDelayedFlag(true, POPUP_FADE_OUT_AT_MS);
  const winFillFading = useDelayedFlag(true, WIN_FILL_FADE_AT_MS);
  const winFillGone = useDelayedFlag(true, WIN_FILL_GONE_AT_MS);
  if (!verdict || gone) return null;
  const isWin = verdict === 'win';
  return (
    // Not a modal: no backdrop, pointer-events-none, so the frozen board behind stays sharp + visible.
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <motion.div
        data-testid="chess-result-popup"
        data-outcome={verdict}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: fadingOut ? 0 : 1, scale: 1 }}
        transition={{ duration: fadingOut ? POPUP_OUT_S : POPUP_IN_S, ease: 'easeOut' }}
        className={cn('relative overflow-hidden rounded-[18px] bg-surface px-8 py-4 shadow-xl', outlineClasses(verdict))}
      >
        {/* Win: a GREEN fill layer over the navy panel (same as the own-bar win fill), held then faded
            back to navy — leaving the "You Won" text + the green outline. Loss/draw: navy the whole way. */}
        {isWin && !winFillGone && (
          <motion.span
            aria-hidden="true"
            data-testid="chess-result-fill"
            initial={{ opacity: 1 }}
            animate={{ opacity: winFillFading ? 0 : 1 }}
            transition={{ duration: POPUP_OUT_S, ease: 'easeOut' }}
            className="pointer-events-none absolute inset-0 bg-success"
          />
        )}
        <span data-testid="chess-result-text" className={cn('relative z-10 text-lg font-black uppercase tracking-wide', isWin ? 'text-white' : 'text-foreground')}>
          {chessResultLine(verdict, opponentName)}
        </span>
      </motion.div>
    </div>
  );
}

// ── Draw offers: the SECONDARY-action button (Play-a-Friend slot) during a match (CHESS_DRAW_OFFER.md) ─
// Symmetric mutual request: Draw request offers immediately (button → Revoke DRAW + a "Draw offered"
// bar indicator on both screens); pressing your own Draw request while the opponent already offered
// completes the draw; Revoke withdraws your own offer. NO confirm step (unlike Resign) — an offer
// alone can't end the game or cost the stake and is revocable. Server-authoritative: the button
// reflects the public offer state (view.drawOffers), never local optimism.
function ChessSecondaryAction({ args }: { args: GameAreaArgs }) {
  const { gameState, playerId, onDrawOffer, onDrawRevoke } = args;
  const view = gameState as ChessView | null;
  const offered = Boolean(playerId && view?.drawOffers?.[playerId]);
  const base = 'w-full rounded-xl py-3.5 text-[15px] font-bold transition-colors';
  if (offered) {
    return (
      <button
        type="button"
        data-testid="chess-draw-revoke"
        onClick={() => onDrawRevoke?.()}
        className={cn(base, 'bg-amber-400/15 text-amber-400 ring-1 ring-amber-400/50 hover:bg-amber-400/25')}
      >
        Revoke DRAW
      </button>
    );
  }
  return (
    <button
      type="button"
      data-testid="chess-draw-offer"
      onClick={() => onDrawOffer?.()}
      className={cn(base, 'bg-background text-foreground hover:brightness-125')}
    >
      Draw request
    </button>
  );
}

/** The Chess game-area slot: ONE full-bleed board in every phase (never empty). Idle/searching →
 *  the starting-position preview; in-match → the live board; post-game → the frozen final. The
 *  board itself gates interactivity on legalMoves, so the preview and frozen states are static.
 *  On match end the lightweight result popup fades in OVER the frozen final position (the board
 *  stays sharp — no modal); the lasting green/red/orange indicator is the own bar (ownBarResult).
 *  The arena owns its surface (no grey table card). */
function ChessPanel(args: GameAreaArgs) {
  return (
    <div className="relative">
      <ChessBoard {...args} />
      {args.phase === 'result' && args.outcome && (
        <ChessResultPopup outcome={args.outcome} playerId={args.playerId} opponentName={args.opponentName} />
      )}
    </div>
  );
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
  // Chess opts OUT of the shared heavy result overlay (no blur/confetti/wallet/balance/trophy/X) —
  // it shows the lightweight in-hub popup over the frozen board instead (ChessPanel) — and opts IN
  // to the shared own-bar outline (ownBarResult), the persistent green/red/orange indicator that
  // lives past the popup and clears only on PLAY/leave (round-scoped-state rule).
  return (
    <GameHub
      gameId="chess"
      gameName="Chess"
      renderGameArea={ChessPanel}
      renderSlotAside={ChessSlotAside}
      // Draw offers live on the secondary-action button in-match (Play a Friend → Draw request ⇄
      // Revoke DRAW); idle/result fall back to the default Play a Friend (null). CHESS_DRAW_OFFER.md.
      renderSecondaryAction={(args) => (args.phase === 'in-match' ? <ChessSecondaryAction args={args} /> : null)}
      suppressResultOverlay
      ownBarResult
      {...props}
    />
  );
}
