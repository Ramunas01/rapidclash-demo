import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { MinesView } from '../App.js';
import { useTheme } from '../lib/theme.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

// 5×5 / 3-mine ruleset (Designer, 2026-09-11 — see docs/NEW_DESIGN_MIGRATION.md § "Canonical
// new Mines ruleset"). T7 (#437-ish) rewrote the engine to this shape; T8 (this file) is the
// full visual rebuild to the prototype's `isMines` block (`design/prototype/RapidClash Full
// Spec.html:470-529`) — hand-drawn gem/mine SVGs, the real card/board radii + colors, and the
// 30s round clock. The covered/safe/mine/busted cell LOGIC (`cellKind` below) is UNCHANGED from
// T7's minimum fix — only what renders inside each state changed.
const BOARD_SIZE = 25; // 5×5

// The round clock is a fixed 30s cap from `roundStartedAt` (packages/games/mines/src/board.ts's
// `ROUND_TIMEOUT_MS`). Kept as a local constant so the web app stays decoupled from the game
// packages — the same rule CoinflipHub.tsx's `PICK_SECONDS` and RpsHub.tsx's `PICK_SECONDS`
// already follow for their own server-side timer constants.
const ROUND_SECONDS = 30;

type CellKind = 'covered' | 'safe' | 'mine' | 'bustedOn';

// ── Prototype-literal colors, Full Spec.html:470-529 (`isMines` block) + :3720-3722/:3792 (the
// `getState()` values feeding it). None of these match an existing --rc-* token pair (checked
// directly against index.css) except `minesCardBg`, which IS exactly `--rc-surface` in both
// themes (RpsHub.tsx:333's own note) — reused as `var(--rc-surface)` below rather than
// duplicated. The rest stay local, switched via `useTheme()` — DiceHub.tsx's `DICE_TRACK`/
// `DICE_GROOVE` precedent for the same situation. ──
const MINES_BOARD_BG = { light: '#DEDEE8', dark: '#12121F' }; // line 3721 (`minesBoardBg`) — also
// reused for the timer track (line 3792 `minesTimerTrack`): identical light/dark pair.
const MINES_TILE_COVERED = { light: '#CBCBD8', dark: '#232338' }; // line 3722 (`minesTileBg`) —
// line 3694's `t.bg` else-branch (not open).
const MINES_TILE_OPEN = { light: '#F2F2F7', dark: '#0E0E18' }; // line 3694's `open` branch — a
// revealed safe tile, or the exact mine that busted you.
const MINES_TILE_AUTO = { light: '#E2E2EA', dark: '#0A0A12' }; // line 3694's `auto` branch — a
// mine revealed by locking, but not the one you actually hit (dimmer than the hit tile).
const MINES_TIMER_FILL = '#8B45F0'; // line 524 — the progress-track fill, fixed in both themes.

function tileBg(kind: CellKind, light: boolean): string {
  switch (kind) {
    case 'covered':
      return light ? MINES_TILE_COVERED.light : MINES_TILE_COVERED.dark;
    case 'mine':
      return light ? MINES_TILE_AUTO.light : MINES_TILE_AUTO.dark;
    case 'safe':
    case 'bustedOn':
      return light ? MINES_TILE_OPEN.light : MINES_TILE_OPEN.dark;
  }
}

/** The faceted gem, lines 508-516 — a revealed safe tile. Exact path data, not approximated. */
function GemIcon() {
  return (
    <svg viewBox="0 0 48 44" width="62%" className="block">
      <path d="M24 43 L2 16 L11 3 L37 3 L46 16 Z" fill="#16C447" />
      <path d="M24 43 L2 16 L17 16 Z" fill="#22DD55" />
      <path d="M24 43 L17 16 L31 16 Z" fill="#3BF06B" />
      <path d="M24 43 L31 16 L46 16 Z" fill="#1BCE4C" />
      <path d="M2 16 L11 3 L17 16 Z" fill="#4CF97A" />
      <path d="M17 16 L11 3 L24 3 L31 16 Z" fill="#2AE95E" />
      <path d="M31 16 L24 3 L37 3 L46 16 Z" fill="#5DFB88" />
    </svg>
  );
}

/** The gem's glow halo, lines 505-507 — shown at 0.55 opacity behind the solid gem (line 3697,
 *  `gemHaloOp: picked && !bomb ? 0.55 : 0`; every safe tile we render here IS one this player
 *  tapped, so it always gets the halo). */
function GemHalo() {
  return (
    <svg viewBox="0 0 48 44" width="62%" className="block" style={{ filter: 'blur(3.5px)' }}>
      <path d="M24 43 L2 16 L11 3 L37 3 L46 16 Z" fill="#3CF06E" />
    </svg>
  );
}

/** The spiky mine, lines 489-503 — a revealed mine (either the one that busted you, or one of
 *  the other two exposed once you're locked). `opacity` mirrors line 3700's `bombOp`: 1 for the
 *  hit tile, 0.26 for the others. */
function MineIcon({ opacity }: { opacity: number }) {
  return (
    <svg viewBox="0 0 48 48" width="66%" className="block" style={{ opacity }}>
      <g fill="#3A3E46">
        <rect x="21.5" y="2" width="5" height="9" rx="2.5" />
        <rect x="21.5" y="37" width="5" height="9" rx="2.5" />
        <rect x="2" y="21.5" width="9" height="5" rx="2.5" />
        <rect x="37" y="21.5" width="9" height="5" rx="2.5" />
        <rect x="8" y="8.6" width="5" height="9" rx="2.5" transform="rotate(-45 10.5 13.1)" />
        <rect x="35" y="8.6" width="5" height="9" rx="2.5" transform="rotate(45 37.5 13.1)" />
        <rect x="8" y="30.4" width="5" height="9" rx="2.5" transform="rotate(45 10.5 34.9)" />
        <rect x="35" y="30.4" width="5" height="9" rx="2.5" transform="rotate(-45 37.5 34.9)" />
      </g>
      <circle cx="24" cy="24" r="15" fill="#41454E" />
      <path d="M24 9 a15 15 0 0 1 0 30 a15 15 0 0 0 0 -30" fill="#33363E" />
      <circle cx="18.5" cy="18" r="4.6" fill="#4E525C" opacity="0.75" />
      <path d="M27 11 L21.5 22 L26.5 23 L20 37 L27 24.5 L22.5 23.5 Z" fill="#FF8A1E" />
      <path d="M26 13.5 L22.8 22.4 L26.2 23.2 L22 33 L26 24.6 L23.3 23.9 Z" fill="#FFD23D" />
    </svg>
  );
}

/** The mine's glow halo, lines 475-487 — shown only on the tile that actually busted you (line
 *  3699, `bombHaloOp: hit ? 1 : 0`). */
function MineHalo() {
  return (
    <svg
      viewBox="0 0 48 48"
      width="66%"
      className="block"
      style={{ filter: 'blur(3.5px) drop-shadow(0 0 3px rgba(255,60,85,0.85))' }}
    >
      <g fill="#FF3E5E">
        <rect x="21.5" y="2" width="5" height="9" rx="2.5" />
        <rect x="21.5" y="37" width="5" height="9" rx="2.5" />
        <rect x="2" y="21.5" width="9" height="5" rx="2.5" />
        <rect x="37" y="21.5" width="9" height="5" rx="2.5" />
        <rect x="8" y="8.6" width="5" height="9" rx="2.5" transform="rotate(-45 10.5 13.1)" />
        <rect x="35" y="8.6" width="5" height="9" rx="2.5" transform="rotate(45 37.5 13.1)" />
        <rect x="8" y="30.4" width="5" height="9" rx="2.5" transform="rotate(45 10.5 34.9)" />
        <rect x="35" y="30.4" width="5" height="9" rx="2.5" transform="rotate(-45 37.5 34.9)" />
        <circle cx="24" cy="24" r="15.5" />
      </g>
    </svg>
  );
}

/** What renders inside one tile, by `cellKind` — the ONLY thing T8 changes about a cell; the
 *  covered/safe/mine/bustedOn classification itself (`cellKind()` below) is untouched. */
function MineTileContent({ kind }: { kind: CellKind }) {
  if (kind === 'safe') {
    return (
      <>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <GemHalo />
        </div>
        <GemIcon />
      </>
    );
  }
  if (kind === 'mine') {
    return <MineIcon opacity={0.26} />;
  }
  if (kind === 'bustedOn') {
    return (
      <>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <MineHalo />
        </div>
        <MineIcon opacity={1} />
      </>
    );
  }
  return null;
}

/** Greyed preview shown in Idle/Waiting — a dimmed 5×5 grid, the visual anchor before a
 *  match activates it (mirrors RpsIdle / CoinflipIdle). Per Advisor ticket 2026-09-11#4: the
 *  prototype has no separate idle-state design for Mines — its tile-computation code is the SAME
 *  function that renders the live in-match board, just showing every tile in its default covered
 *  state before a match starts. So this reuses the live board's own `MINES_BOARD_BG`/
 *  `MINES_TILE_COVERED` values and radii (rounded-2xl board / rounded-[9px] tiles, matching
 *  `MinesBoard` below) rather than a separate generic gray grid, dimmed via `opacity-50`. */
function MinesIdle({ phase }: { phase: GameAreaArgs['phase'] }) {
  const { resolved: themeResolved } = useTheme();
  const light = themeResolved === 'light';
  return (
    <div className="flex flex-col items-center gap-4 py-1">
      <div
        aria-hidden
        className="grid w-full grid-cols-5 gap-2 rounded-2xl p-2.5 opacity-50"
        style={{ background: light ? MINES_BOARD_BG.light : MINES_BOARD_BG.dark }}
      >
        {Array.from({ length: BOARD_SIZE }, (_, i) => (
          <div
            key={i}
            className="aspect-square rounded-[9px]"
            style={{ background: light ? MINES_TILE_COVERED.light : MINES_TILE_COVERED.dark }}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {phase === 'waiting' ? 'Waiting for an opponent…' : 'Choose a bet and press PLAY, or JOIN an open challenge'}
      </p>
    </div>
  );
}

/** The 30s round-clock label + progress track, lines 520-527. `{{minesClock}}s` (13px, Space
 *  Grotesk bold) above a 5px rounded track (`minesTimerTrack`, line 523 — the same light/dark
 *  pair as `minesBoardBg`) filled purple (line 524, `#8B45F0`) to `(clock/30)*100%`, animating
 *  via `transition:width 1000ms linear` — copied verbatim, not approximated.
 *
 * Driven by the server-authoritative `roundStartedAt` (T8's one `viewFor` field addition,
 * packages/games/mines/src/mines.ts), NOT a client-guessed/reset-on-render value: deadline is
 * `roundStartedAt + ROUND_SECONDS * 1000`, exactly mirroring `scheduledDeadlines`' own math
 * (packages/games/mines/src/mines.ts). Same cosmetic-countdown idiom as CoinflipHub.tsx's
 * `CountdownRing` / RpsHub.tsx's `RpsCountdown` (`windowEndsAt` there vs `roundStartedAt` here —
 * Mines' clock is a per-ROUND cap shared by both players, not a per-player pick window, so it
 * keeps counting even after THIS player has locked, reflecting the opponent's remaining time).
 */
function RoundClock({ roundStartedAt, serverClockOffset, light }: { roundStartedAt: number | undefined; serverClockOffset: number; light: boolean }) {
  const [secondsLeft, setSecondsLeft] = useState(ROUND_SECONDS);

  useEffect(() => {
    if (!roundStartedAt) {
      setSecondsLeft(ROUND_SECONDS);
      return;
    }
    const deadline = roundStartedAt + ROUND_SECONDS * 1000;
    const tick = () => {
      const remaining = (deadline - (Date.now() + serverClockOffset)) / 1000;
      setSecondsLeft(Math.max(0, Math.min(ROUND_SECONDS, Math.ceil(remaining))));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [roundStartedAt, serverClockOffset]);

  const trackBg = light ? MINES_BOARD_BG.light : MINES_BOARD_BG.dark;
  const widthPct = Math.max(0, Math.min(100, (secondsLeft / ROUND_SECONDS) * 100));

  return (
    <div className="flex flex-col items-end gap-[5px] pt-3" data-testid="mines-round-clock">
      <span
        className="font-bold leading-none text-[var(--rc-text)]"
        style={{ fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif", fontSize: 13 }}
      >
        {secondsLeft}s
      </span>
      <div className="h-[5px] w-full overflow-hidden rounded-full" style={{ background: trackBg }}>
        <div
          className="mr-auto h-full rounded-full"
          style={{ width: `${widthPct}%`, background: MINES_TIMER_FILL, transition: 'width 1000ms linear' }}
        />
      </div>
    </div>
  );
}

/**
 * The live in-match board — MinesPlay's own 5×5 grid lifted into the GameHub slot, v2-tokenised.
 * Covered tiles fire onMove(index), gated by the server-issued legalMoves (this player's still-
 * covered squares). Own uncovered-safe / busted / mine cells render once known; the opponent's
 * board is NEVER rendered (viewFor redaction), and their safe-count stays hidden until BOTH
 * players' rounds are over (no early resolution, no mid-round chase — 2026-09-11 ruleset). An
 * internal draw-replay re-deals the board within the same match — the cells derive straight from
 * gameState, so a new round (round bumps, uncovered resets) re-covers the board on its own; only
 * the decisive match.end surfaces the GameHub result overlay.
 */
function MinesBoard({ playerId, opponentId, username, gameState, legalMoves, onMove, onForfeit, serverClockOffset = 0 }: GameAreaArgs) {
  const { resolved: themeResolved } = useTheme();
  const light = themeResolved === 'light';
  const view = gameState as MinesView | null;
  // Mines moves are square indices: legalMoves/onMove are number-valued here (the GameHub slot
  // types them as string for the generic games — narrow them back for Mines).
  const legalIdx = legalMoves as unknown as number[];
  const moveIdx = onMove as unknown as (i: number) => void;

  const me = playerId ? view?.boards?.[playerId] : undefined;
  const opp = view && opponentId ? view.boards?.[opponentId] : undefined;

  const round = view?.round ?? 0;
  const myUncovered = useMemo(() => new Set(me?.uncovered ?? []), [me?.uncovered]);
  const myScore = me?.uncovered?.length ?? 0;
  const myLocked = me?.locked ?? false;
  const bustedOn = me?.bustedOn;
  // The mine layout is present in my view only once I've locked (busted/cleared); at terminal
  // it also arrives at the top level. Either way it's safe — I have no move left.
  const myMines = useMemo(
    () => new Set(me?.mines ?? view?.mines ?? []),
    [me?.mines, view?.mines],
  );
  const legalSet = useMemo(() => new Set(legalIdx), [legalIdx]);
  const canMove = !myLocked && legalIdx.length > 0;

  // Opponent's safe-count is server-redacted: hidden for the WHOLE round, revealed only once
  // BOTH players have locked (2026-09-11 ruleset — no early resolution, no mid-round chase).
  // We NEVER see their board, in-play or otherwise.
  const oppScore = opp?.score;
  const oppLocked = opp?.locked ?? false;

  function cellKind(i: number): CellKind {
    if (bustedOn === i) return 'bustedOn';
    if (myUncovered.has(i)) return 'safe';
    if (myMines.has(i)) return 'mine'; // revealed only once I'm locked
    return 'covered';
  }

  const myStatus = myLocked ? (bustedOn !== undefined ? 'Busted' : 'Board cleared') : 'Your move';

  return (
    <div className="flex flex-col gap-3" data-testid="hub-board">
      {/* You / opponent count (chase) / round */}
      <div className="flex items-center justify-between text-xs">
        <span data-testid="play-you" className="font-medium text-muted-foreground">
          {username ? <>You (<strong className="text-foreground">{username}</strong>)</> : 'You'}
          <span className="ml-1 text-foreground/40">· {myScore} safe</span>
        </span>
        {round > 0 && (
          <span data-testid="round-indicator" className="rounded-full bg-surface px-2 py-0.5 text-muted-foreground">
            Round {round + 1}
          </span>
        )}
        <span data-testid="opponent-count" className="font-medium text-muted-foreground">
          Opponent ·{' '}
          {oppScore !== undefined ? (
            <strong className="text-foreground">{oppScore} safe</strong>
          ) : (
            <span className="text-foreground/40" aria-label="hidden">🙈</span>
          )}
          {oppLocked && <span className="ml-1 text-foreground/40">locked</span>}
        </span>
      </div>

      {/* Status */}
      <div className="flex items-center justify-between">
        <span
          data-testid="my-status"
          className={cn(
            'text-sm font-semibold',
            myLocked ? (bustedOn !== undefined ? 'text-destructive' : 'text-success') : 'text-brand',
          )}
        >
          {myStatus}
        </span>
      </div>

      {/* Own 5×5 board, lines 470-518 — inner board radius 16px, bg `minesBoardBg`, 10px padding,
       *  a 5-col grid with 8px gaps; each tile radius 9px. The opponent's board is NEVER rendered
       *  (server hides it). */}
      <div
        data-testid="mines-board"
        role="grid"
        aria-label="Your minefield"
        className="grid grid-cols-5 gap-2 rounded-2xl p-2.5"
        style={{ background: light ? MINES_BOARD_BG.light : MINES_BOARD_BG.dark }}
      >
        {Array.from({ length: BOARD_SIZE }, (_, i) => {
          const kind = cellKind(i);
          const clickable = kind === 'covered' && canMove && legalSet.has(i);
          return (
            <motion.button
              key={i}
              type="button"
              role="gridcell"
              disabled={!clickable}
              onClick={() => clickable && moveIdx(i)}
              aria-label={`Square ${i}${kind === 'covered' ? '' : ` (${kind})`}`}
              data-testid={`cell-${i}`}
              data-kind={kind}
              whileHover={clickable ? { scale: 1.08 } : undefined}
              whileTap={clickable ? { scale: 0.92 } : undefined}
              className={cn(
                'relative flex aspect-square items-center justify-center rounded-[9px] transition-colors',
                clickable ? 'cursor-pointer' : kind === 'covered' ? 'cursor-not-allowed opacity-70' : 'cursor-default',
              )}
              style={{ background: tileBg(kind, light) }}
            >
              <MineTileContent kind={kind} />
            </motion.button>
          );
        })}
      </div>

      <RoundClock roundStartedAt={view?.roundStartedAt} serverClockOffset={serverClockOffset} light={light} />

      <p className="text-center text-xs text-muted-foreground">
        {myLocked
          ? oppLocked
            ? 'Resolving…'
            : 'Locked in — waiting for your opponent to finish their round.'
          : 'Tap a tile. Avoid the mines — most safe tiles wins. A mine, 22 safe tiles, or the clock ends your round.'}
      </p>

      {!myLocked && (
        <button
          type="button"
          onClick={onForfeit}
          className="pt-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Resign
        </button>
      )}
    </div>
  );
}

/** The Mines game-area slot: greyed idle preview, or the live board in-match. Full Spec.html:471
 *  — border-radius:22px, background `minesCardBg`, padding 12px 12px 16px 12px. `minesCardBg` IS
 *  exactly `--rc-surface` in both themes (RpsHub.tsx:333's own note) — read via the token rather
 *  than re-deriving the same value. */
function MinesPanel(args: GameAreaArgs) {
  return (
    <div className="rounded-[22px] bg-[var(--rc-surface)] px-3 pb-4 pt-3">
      {args.phase === 'in-match' ? <MinesBoard {...args} /> : <MinesIdle phase={args.phase} />}
    </div>
  );
}

/**
 * Mines Hub = the shared GameHub + a Mines play-panel (own 5×5 board, hidden opponent count
 * until both round, viewFor redaction). The WS flow and server-authoritative redaction are
 * unchanged — this is a presentation slot. See docs/MINES.md.
 */
export function MinesHubScreen(props: GameHubScreenProps) {
  return <GameHub gameId="mines" gameName="Mines" renderGameArea={MinesPanel} {...props} />;
}
