import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { MinesView, MinesBoardView } from '../App.js';
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

// Ticket 2026-09-17#1 item 2: the ruleset's own safe-tile count (`packages/games/mines/src/board.ts`
// — `SAFE_COUNT = BOARD_SIZE - MINE_COUNT` = 22), mirrored locally for the same decoupling reason
// `ROUND_SECONDS`/`BOARD_SIZE` above already are — used to distinguish "locked because I cleared
// the board" from "locked because my clock ran out" (both otherwise look identical: locked, not
// busted).
const SAFE_COUNT = 22;

// Ticket 2026-09-16#6 item 2: 'autoSafe' — a safe tile you never personally tapped, auto-revealed
// once you're locked (busted), matching the prototype's own `open = picked || busted` (all 25
// tiles satisfy `open` the instant a bust happens, not just the picked/mine ones).
type CellKind = 'covered' | 'safe' | 'mine' | 'bustedOn' | 'autoSafe';

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
    case 'autoSafe':
      return light ? MINES_TILE_AUTO.light : MINES_TILE_AUTO.dark;
    case 'safe':
    case 'bustedOn':
      return light ? MINES_TILE_OPEN.light : MINES_TILE_OPEN.dark;
  }
}

// Ticket 2026-09-17#2 item 1: D24's own fix (wrapping the icon in `absolute inset-0 flex
// items-center justify-center`) recurs one level deeper — that wrapper measures dead-center, but
// its child (a motion.div containing a percentage-width SVG) is ITSELF still a bare, normal-flow
// flex item with the SAME ambiguous-sizing content, so the bug reappears one layer down. Empirical
// fix (verified against the live deployed page, not a synthetic repro — see this session's own
// docs for why a synthetic one gave a false negative): eliminate every intermediate flex-item
// layer. The icon is now a `motion.svg` directly, `position:absolute` with NO offsets — it relies
// on the TILE BUTTON's own `flex items-center justify-center` for "static position" centering,
// which only works because the icon is a DIRECT CHILD of that flex container; any wrapper
// reintroduced between them (flex or not) breaks this. Halos get the identical treatment (drop the
// wrapper, `position:absolute` straight on the halo SVG) — they were never animated, so no motion
// component needed there. `opacity` still carries the STEADY-STATE target (1, or 0.26 for a dimmed
// non-hit mine) — Framer's own `animate` now targets it directly (not a nested-multiplication
// trick through a wrapper's own separate 0→1 fade).

/** The faceted gem, lines 508-516 — a revealed safe tile. Exact path data, not approximated. */
// Ticket 2026-09-16#6 item 2: `opacity` mirrors `MineIcon`'s own shape — 1 for a tile you actually
// tapped, 0.26 for a safe tile auto-revealed on bust (never tapped). Full opacity was previously
// the only state this ever rendered at (the prop is new; every existing call site now passes 1).
function GemIcon({ opacity }: { opacity: number }) {
  return (
    <motion.svg
      viewBox="0 0 48 44"
      width="62%"
      className="absolute block"
      initial={{ opacity: 0, scale: 0.4 }}
      animate={{ opacity, scale: 1 }}
      transition={REVEAL_POP_TRANSITION}
    >
      <path d="M24 43 L2 16 L11 3 L37 3 L46 16 Z" fill="#16C447" />
      <path d="M24 43 L2 16 L17 16 Z" fill="#22DD55" />
      <path d="M24 43 L17 16 L31 16 Z" fill="#3BF06B" />
      <path d="M24 43 L31 16 L46 16 Z" fill="#1BCE4C" />
      <path d="M2 16 L11 3 L17 16 Z" fill="#4CF97A" />
      <path d="M17 16 L11 3 L24 3 L31 16 Z" fill="#2AE95E" />
      <path d="M31 16 L24 3 L37 3 L46 16 Z" fill="#5DFB88" />
    </motion.svg>
  );
}

/** The gem's glow halo, lines 505-507 — shown at 0.55 opacity behind the solid gem (line 3697,
 *  `gemHaloOp: picked && !bomb ? 0.55 : 0`; every safe tile we render here IS one this player
 *  tapped, so it always gets the halo). */
function GemHalo() {
  return (
    <svg viewBox="0 0 48 44" width="62%" className="pointer-events-none absolute block" style={{ filter: 'blur(3.5px)' }}>
      <path d="M24 43 L2 16 L11 3 L37 3 L46 16 Z" fill="#3CF06E" />
    </svg>
  );
}

/** The spiky mine, lines 489-503 — a revealed mine (either the one that busted you, or one of
 *  the other two exposed once you're locked). `opacity` mirrors line 3700's `bombOp`: 1 for the
 *  hit tile, 0.26 for the others. `animation` (ticket 2026-09-16#6 item 3): the hit tile's own
 *  `rcMineJump` bounce — applied directly here now that there's no separate CSS-animated wrapper
 *  layer to carry it (that layer was itself one of the flex-item wrappers item 1 eliminates).
 *  Coexists with Framer's own `animate` on the SAME element (both touch `transform` briefly during
 *  the ~300ms reveal-pop, before Framer's own control of it settles) — a known, accepted overlap;
 *  see this ticket's own PR description for why the alternative (a separate wrapper) isn't safe
 *  here without breaking the centering fix this item exists to make. */
function MineIcon({ opacity, animation }: { opacity: number; animation?: string }) {
  return (
    <motion.svg
      viewBox="0 0 48 48"
      width="66%"
      className="absolute block"
      initial={{ opacity: 0, scale: 0.4 }}
      animate={{ opacity, scale: 1 }}
      transition={REVEAL_POP_TRANSITION}
      style={animation ? { animation } : undefined}
    >
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
    </motion.svg>
  );
}

/** The mine's glow halo, lines 475-487 — shown only on the tile that actually busted you (line
 *  3699, `bombHaloOp: hit ? 1 : 0`). `animation`: the same `rcMineJump` bounce as `MineIcon`
 *  above — the prototype applies it to both the bomb halo AND the bomb icon SVGs identically
 *  (`:475`/`:488`). No Framer element here (halos are never animated on reveal), so no overlap. */
function MineHalo({ animation }: { animation?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width="66%"
      className="pointer-events-none absolute block"
      style={{ filter: 'blur(3.5px) drop-shadow(0 0 3px rgba(255,60,85,0.85))', animation }}
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
// Ticket 2026-09-16#5 item 5: the gem/bomb icon's own reveal pop — `gemOp`/`gemScale`/`bombOp`/
// `bombScale` (`Full Spec.html:508/488`), opacity 0→1 (0→0.26 for a non-hit exposed mine — see
// below), scale 0.4→1, `transition:opacity 180ms ease, transform 300ms cubic-bezier(0.34,1.7,0.5,1)`
// — the same convention RPS's own rock/paper/scissors icon reveals already use (`:611-613/634-636`,
// byte-identical transition string). Our `MineTileContent` used to just conditionally render the
// icon with no transition at all — instant appear. (The tile's own `transform:scale({{t.scale}})`,
// `:474`, is very likely inert in the prototype itself — `t.scale` is a constant `1`, never changes
// — so it's not ported; only the icon's own reveal pop is real.) Ticket 2026-09-17#2 item 1: GemIcon/
// MineIcon are now `motion.svg` elements themselves (no wrapping `motion.div` — see that item's own
// header comment above `GemIcon`) — `animate={{ opacity, scale: 1 }}` targets the real steady-state
// opacity DIRECTLY now, not via the old wrapper-multiplication trick.
const REVEAL_POP_TRANSITION = { duration: 0.3, ease: [0.34, 1.7, 0.5, 1] as const };
// Ticket 2026-09-16#6 item 3: the hit tile's bounce (`Full Spec.html:3702`, `bombAnim: hit ?
// 'rcMineJump 4000ms cubic-bezier(0.32,0.72,0.4,1) 1 both' : 'none'`) — applies to BOTH the bomb
// halo and bomb icon on the busted tile specifically, never the other exposed mines.
const BOMB_JUMP_ANIM = 'rcMineJump 4000ms cubic-bezier(0.32,0.72,0.4,1) 1 both';
function MineTileContent({ kind }: { kind: CellKind }) {
  // Ticket 2026-09-17#2 item 1: NO wrapper divs — `GemIcon`/`MineIcon`/`GemHalo`/`MineHalo` are all
  // direct children of the tile button now, each `position:absolute` on their own root SVG (see
  // the block comment above `GemIcon`'s own definition for the full empirical reasoning). DOM order
  // still determines paint order between two `position:absolute` siblings with `z-index:auto`
  // (2026-09-16#6) — halo first, icon second, so the icon paints on top.
  if (kind === 'safe') {
    return (
      <>
        <GemHalo />
        <GemIcon opacity={1} />
      </>
    );
  }
  if (kind === 'autoSafe') {
    return <GemIcon opacity={0.26} />;
  }
  if (kind === 'mine') {
    // Ticket 2026-09-16#6 item 1: position:absolute, matching the prototype's own bomb-icon SVG
    // (`:488`, always position:absolute) — no halo sibling exists for this kind, so this is a
    // harmless, literal port here, not a fix (the fix that actually matters is the `bustedOn`
    // branch below, where a halo sibling is present).
    return <MineIcon opacity={0.26} />;
  }
  if (kind === 'bustedOn') {
    return (
      <>
        <MineHalo animation={BOMB_JUMP_ANIM} />
        <MineIcon opacity={1} animation={BOMB_JUMP_ANIM} />
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
function MinesIdle() {
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
      {/* Ticket 2026-09-12#2 item 1 (ADVISOR_TO_PM.md): the "Waiting for an opponent…"/"Choose a bet
          and press PLAY…" paragraph that used to render here was removed — grepped the prototype's
          entire `isMines` idle/board block (Full Spec.html:470-529, gated only by `minesBoardOp`/
          `minesClockOp`) and it has zero idle copy for either sub-state, just the tile grid + clock.
          `GameHub.tsx`'s shared PLAY-button label ("Waiting for an opponent · m:ss") already covers
          the waiting case, same precedent as RpsHub.tsx's identical removal in #551. Do not re-add
          it; `phase` was dropped from this component's props along with it (no other reader left). */}
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
// Ticket 2026-09-16#5 item 1: MinesBoard's own internal You/Opponent status row + "Your move"/
// "Busted"/"Board cleared" status line + explainer paragraph + Resign button all had zero
// equivalent anywhere in the prototype's own `isMines` block (`Full Spec.html:470-529`, confirmed
// directly). The shared GameHub bars already show the real avatar/name, and OpponentSlot's own
// existing "Playing…" fallback already covers the right-side status (MinesHubScreen passes no
// renderSlotAside) — this was pure duplicate chrome, not a missing-elsewhere feature. `onForfeit`
// itself is untouched (still fully generic, shared infra — RPS/Chess/Blackjack's own real Resign
// buttons still use it); only Mines' own now-orphaned Resign button is gone.
function MinesBoard({ playerId, gameState, legalMoves, onMove, serverClockOffset = 0 }: GameAreaArgs) {
  const { resolved: themeResolved } = useTheme();
  const light = themeResolved === 'light';
  const view = gameState as MinesView | null;
  // Mines moves are square indices: legalMoves/onMove are number-valued here (the GameHub slot
  // types them as string for the generic games — narrow them back for Mines).
  const legalIdx = legalMoves as unknown as number[];
  const moveIdx = onMove as unknown as (i: number) => void;

  const me = playerId ? view?.boards?.[playerId] : undefined;

  const myUncovered = useMemo(() => new Set(me?.uncovered ?? []), [me?.uncovered]);
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

  function cellKind(i: number): CellKind {
    if (bustedOn === i) return 'bustedOn';
    if (myUncovered.has(i)) return 'safe';
    if (myMines.has(i)) return 'mine'; // revealed only once I'm locked
    // Ticket 2026-09-16#6 item 2: once locked, every remaining tile reveals — the prototype's own
    // `open = picked || busted` (Full Spec.html:3690-3694) opens ALL 25 tiles the instant a bust
    // happens, not just the picked/mine ones. A tile that's neither picked nor a mine, revealed
    // this way, is a ghosted safe tile ('autoSafe') — still 'covered' only while still playing.
    if (myLocked) return 'autoSafe';
    return 'covered';
  }

  return (
    <div className="flex flex-col gap-3" data-testid="hub-board">
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
                'relative flex aspect-square items-center justify-center rounded-[9px]',
                // Ticket 2026-09-17#7 (D29): `opacity-70` used to pair with the disabled state here,
                // but the disabled state fires on EVERY tap (App.tsx's shared handleMakeMove clears
                // legalMoves right after a successful submit, for every hub, not Mines-specific) —
                // with legalMoves briefly empty, every other still-covered tile goes !clickable for
                // that whole round-trip window, so all 24 of them flickered dim on every tap, safe or
                // mine. `disabled={!clickable}` (functional gate — still correctly blocks a double-
                // tap mid-round-trip) stays; only the visible dim, which was a false-positive signal
                // with no other legitimate state to protect (a 'covered' tile only ever exists while
                // actively, un-locked mid-round — see `cellKind()`), is removed.
                clickable ? 'cursor-pointer' : kind === 'covered' ? 'cursor-not-allowed' : 'cursor-default',
              )}
              // Ticket 2026-09-16#5 item 6: the cited `transition:background 200ms ease` (`:474`) —
              // Tailwind's generic `transition-colors` utility defaulted to this project's unmodified
              // 150ms/cubic-bezier(0.4,0,0.2,1) instead (confirmed via tailwind.config.js, no override).
              style={{ background: tileBg(kind, light), transition: 'background 200ms ease' }}
            >
              <MineTileContent kind={kind} />
            </motion.button>
          );
        })}
      </div>

      {/* Ticket 2026-09-16#5 item 4: collapses outside the actively-running round, matching the
          prototype's own gating exactly — `minesClockOp`/`minesClockH` (`Full Spec.html:3758-3759`)
          are 1/46px only while a round is live, 0/0px everywhere else (including the result-hold
          window) — confirmed our own `RoundClock` rendered unconditionally, staying visible through
          the whole result phase.
          Ticket 2026-09-21#1 (D30): `phase === 'result'` was the wrong proxy — it fires far too
          late (near the result sequence's own 'final' beat, not near the lock), so collapsing this
          EARLIER flex sibling's height still happened WHILE the bars were converging, pulling the
          own bar upward through ordinary column-flex reflow — a second, unintended shift the bar's
          own transform never actually changed for. `myLocked` is the same signal the prototype's
          own `minesPhase === 'done'` tracks — flips immediately at lock, 1500ms/500ms before
          converge even starts, so any reflow it causes is fully settled before the bars ever move. */}
      <div
        style={{
          opacity: myLocked ? 0 : 1,
          maxHeight: myLocked ? 0 : 46,
          overflow: 'hidden',
          transition: 'opacity 420ms ease, max-height 620ms cubic-bezier(0.3,0.9,0.32,1)',
        }}
      >
        <RoundClock roundStartedAt={view?.roundStartedAt} serverClockOffset={serverClockOffset} light={light} />
      </div>
    </div>
  );
}

/** The Mines game-area slot: greyed idle preview, or the live board in-match. Full Spec.html:471
 *  — border-radius:22px, background `minesCardBg`, padding 12px 12px 16px 12px. `minesCardBg` IS
 *  exactly `--rc-surface` in both themes (RpsHub.tsx:333's own note) — read via the token rather
 *  than re-deriving the same value.
 *
 *  Ticket 2026-09-12#2 item 2 (ADVISOR_TO_PM.md): fades this whole wrapper to 28% opacity while
 *  `barSlideActive` (threaded through via `GameAreaArgs`, populated because `MinesHubScreen` already
 *  opts into `matchBarSlide="measured"`) — matches `minesBoardOp: rpsMatching || mConverged ? 0.28 :
 *  1` (`Full Spec.html:3756`), same 380ms ease transition + pattern `RpsPanel` got in #551. NOTE:
 *  this only covers the `rpsMatching`/`barSlideActive` half of the prototype's condition — the
 *  post-match `mConverged` dim does NOT apply yet, because that bar-convergence state (ticket
 *  2026-09-12#2 item 3(a)) doesn't exist in this codebase. Do not report the dim as "fully done"
 *  until 3(a) lands too; it's ticketed separately (out of scope here).
 *
 *  Ticket 2026-09-12#5 item 1 (ADVISOR_TO_PM.md) — HIGH PRIORITY correction to #555: this used to
 *  gate on `phase === 'in-match'` only, so the instant `phase` became `'result'` (immediately, since
 *  `MinesHubScreen` sets no `holdResultMs`) the panel unmounted `MinesBoard` and swapped to the blank
 *  `MinesIdle` grid — discarding the fully-resolved board (busted tile / cleared board) before it was
 *  ever visible. `ownBarResult`'s win/lose ring on the bar was unaffected (separate component), which
 *  is why this survived #555's own review. Fix: mirror `CoinflipPanel`'s own `live` gate exactly
 *  (`CoinflipHub.tsx:120`, `phase === 'in-match' || phase === 'result'`) — `MinesBoard` reads only
 *  `gameState`/`legalMoves` (never `phase` itself), so it renders the resolved board correctly with
 *  no further changes needed there. */
function MinesPanel(args: GameAreaArgs) {
  const live = args.phase === 'in-match' || args.phase === 'result';
  return (
    <div
      data-testid="hub-mines-panel"
      className="rounded-[22px] bg-[var(--rc-surface)] px-3 pb-4 pt-3"
      style={{ opacity: args.barSlideActive ? 0.28 : 1, transition: 'opacity 380ms ease' }}
    >
      {live ? <MinesBoard {...args} /> : <MinesIdle />}
    </div>
  );
}

/**
 * Mines Hub = the shared GameHub + a Mines play-panel (own 5×5 board, hidden opponent count
 * until both round, viewFor redaction). The WS flow and server-authoritative redaction are
 * unchanged — this is a presentation slot. See docs/MINES.md.
 *
 * Ticket 2026-09-12#2 item 3(b) (ADVISOR_TO_PM.md): wires `suppressResultOverlay` + `ownBarResult`,
 * the same two props `CoinflipHub.tsx` uses at its own `<GameHub>` call (`CoinflipHub.tsx:339-341`).
 * Unlike RPS's #547→#551 correction (which had to REMOVE this same pair — RPS's `view === 'rps'` is
 * structurally excluded from the prototype's `mOutcome` gate), `ownBarResult` IS the textbook-correct
 * mechanism for Mines: the prototype's own `gameV = view === 'mines' || isDice` (`Full Spec.html:
 * 3519`) is the exact condition that turns on `mOutcome`/`playerBarRing`/`winFillAnim`/`winTextAnim`
 * (`:3522-3528`, `:3787-3789`) — Mines is literally one of the two games this mechanism exists for.
 * The ring is confirmed OWN-BAR ONLY in the prototype (`oppBarRing: 'none'` unconditionally, `:3786`)
 * — `ownBarResult`'s existing behavior (only ever rendering on the player's own bar) already matches
 * this exactly, so no extra gating was needed. Do not assume RPS and Mines must always be handled the
 * same way just because they're both GameHub games — check the prototype's own gate for each.
 */
// Ticket 2026-09-17#1 item 2: a correction to how `2026-09-16#7` shipped this sequence — that fix
// gated ALL THREE beats (converge/reveal/final) behind full match settlement (`lastOutcome &&
// lastSettlement`, i.e. BOTH players locked), so the result ran on the OPPONENT's clock instead of
// mine: if I lock first and they're still playing, my own reveal sequence would wait on them even
// though 'converge' itself (a board-dim + bar-slide) reveals no data at all — only 'reveal' (their
// count) and 'final' (the ring) actually need confirmed data. Corrected mechanism:
//  - 'converge' triggers off MY OWN lock (`MinesBoardView.locked`, packages/games/mines/src/
//    mines.ts — flips true the instant MY round ends, for any of 3 reasons, independent of the
//    opponent), after a reason-based delay derived entirely from already-stable view fields:
//    bust (`bustedOn !== undefined`) → 1500ms (`Full Spec.html:3711`); a clean clear
//    (`uncovered.length === SAFE_COUNT`) or a clock timeout (locked, neither of the above) → 500ms
//    (`:3370` for timeout; the prototype has NO code path for a clean clear at all — its own
//    reveal() handler never early-wins on 22/22, it just waits for the clock even then — so there's
//    no source to confirm a timing against; Owner confirmed defaulting a clear to the timeout's
//    500ms, both being "non-bust" endings, 2026-09-17).
//  - Once 'converge' fires (always, on my own schedule), check the opponent's own `locked`. If
//    already true, schedule 'reveal' at +820ms and 'final' at +700ms after that — today's already-
//    correct relative spacing, run straight through. If not yet true, HOLD at 'converge' (dimmed
//    board, bars together, my own gem row showing live — 2026-09-17#1 item 3 — theirs still hidden)
//    until their `locked` is observed true, THEN schedule 'reveal'/'final' at the same +820/+700
//    relative to THAT release moment, not the original converge timestamp — an unbounded wait, by
//    design (never guess at data the server hasn't confirmed).
//  - `holdResultMs` (below, at the `<GameHub>` call) is now a value computed FRESH on every render,
//    not a fixed constant — see that prop's own comment for why a "last known release moment"
//    ref/effect would race against GameHub's own consuming effect, and how a pure per-render
//    function avoids it while still reducing to exactly today's 3020ms in the straight-through case.
//  - Pre-existing limitation, carried forward unchanged, not solved further: on a fresh mount/
//    reconnect where `me.locked` is already true, there is no server timestamp for exactly when I
//    locked — this file already accepted the same imprecision for the bust-only case before this
//    ticket (arms fresh from "now"); this fix doesn't change that.
type LockReason = 'bust' | 'cleared' | 'timeout';
// Ticket 2026-09-17#4 item (dismiss): 'closed' is a 5th phase, reachable only from 'final' via a
// tap on the game section (`onSectionTap` below) — nothing schedules it automatically. Bar-shift/
// board-dim/VS release "for free" because `resultConverge` (passed to <GameHub>, below) excludes
// it; the gem-count captions/icon-strip need their own explicit treatment since they key off
// `resultPhase` directly, not `resultConverge` — see each prop's own comment at the <GameHub> call.
type ResultPhase = 'idle' | 'converge' | 'reveal' | 'final' | 'closed';
const REASON_DELAY_MS: Record<LockReason, number> = { bust: 1500, cleared: 500, timeout: 500 };
const REVEAL_AFTER_CONVERGE_MS = 820;
const FINAL_AFTER_REVEAL_MS = 700;

/** The 17px gem, no halo/blur, no opacity variance — `minesOppGemList`/`minesGems`'s own SVG
 *  (`Full Spec.html:445-451`/`:670-676`), byte-identical to `GemIcon`'s own path data at opacity 1
 *  (this is a SEPARATE small component, not a reuse of `GemIcon`, since the count-row instance
 *  never needs `GemIcon`'s opacity prop — deliberately not adding an unused parameter). Capped at
 *  `Math.min(count, 22)` (`:3718`/`:3785`, confirmed both cap identically), wrapped, `max-height`
 *  clipped at 38px (`playGemStripH`/`oppGemRowOp`'s own citation). Ticket 2026-09-17#2 item 2: no
 *  `max-width` — the prototype's own citation has none (just `flex:1 1 auto`), and now that the
 *  wrapper actually gets real room to grow (its parent span is `flex-1`, not `shrink-0` — see
 *  `GameHubProps.oppGemRow`'s own doc comment), an inline cap here would just fight that growth for
 *  no reason. `transitionMs` (ticket 2026-09-17#1 item 3): the two rows use DIFFERENT
 *  prototype-cited values — the opponent's own `oppGemRowOp` transition is `320ms` (`:448`), the
 *  player's own `playGemStripOp` is `280ms` (`:674`) — not the same number copied twice, confirmed
 *  by re-reading both citations directly rather than assuming symmetry. */
function GemCountRow({ count, visible, transitionMs = 320 }: { count: number; visible: boolean; transitionMs?: number }) {
  if (count <= 0) return null;
  const shown = Math.min(count, 22);
  return (
    <div
      data-testid="mines-gem-row"
      className="flex flex-wrap content-center gap-[2px] overflow-hidden"
      style={{ maxHeight: 38, opacity: visible ? 1 : 0, transition: `opacity ${transitionMs}ms ease` }}
    >
      {Array.from({ length: shown }, (_, i) => (
        <svg key={i} viewBox="0 0 48 44" width="17" className="block shrink-0">
          <path d="M24 43 L2 16 L11 3 L37 3 L46 16 Z" fill="#16C447" />
          <path d="M24 43 L2 16 L17 16 Z" fill="#22DD55" />
          <path d="M24 43 L17 16 L31 16 Z" fill="#3BF06B" />
          <path d="M24 43 L31 16 L46 16 Z" fill="#1BCE4C" />
          <path d="M2 16 L11 3 L17 16 Z" fill="#4CF97A" />
          <path d="M17 16 L11 3 L24 3 L31 16 Z" fill="#2AE95E" />
          <path d="M31 16 L24 3 L37 3 L46 16 Z" fill="#5DFB88" />
        </svg>
      ))}
    </div>
  );
}

/** Derive WHY a locked board locked, from already-stable view fields alone — no new server/
 *  protocol work needed. `SAFE_COUNT` before the generic 'timeout' fallback: a clean clear also
 *  ends with `locked: true` and no `bustedOn`, so it must be checked explicitly, not assumed away. */
function lockReasonOf(board: MinesBoardView | undefined): LockReason | null {
  if (!board?.locked) return null;
  if (board.bustedOn !== undefined) return 'bust';
  if ((board.uncovered?.length ?? 0) === SAFE_COUNT) return 'cleared';
  return 'timeout';
}

export function MinesHubScreen(props: GameHubScreenProps) {
  const view = props.gameState as MinesView | null;
  const me = props.playerId ? view?.boards?.[props.playerId] : undefined;
  const opp = props.opponentId ? view?.boards?.[props.opponentId] : undefined;

  const [lockReason, setLockReason] = useState<LockReason | null>(null);
  const [resultPhase, setResultPhase] = useState<ResultPhase>('idle');
  // Captured once, the first time `lockReason` is set — the "pre-existing limitation" this
  // section's own header comment accepts (no server timestamp for exactly when I locked).
  const myLockedAtRef = useRef<number | null>(null);
  const convergeArmedRef = useRef(false);
  const revealArmedRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Arm as soon as MY board locks, for ANY of the 3 real reasons — independent of the opponent;
  // 'converge' itself reveals no data, so it never needed to wait on them (see header comment).
  useEffect(() => {
    if (lockReason !== null) return; // already captured for this match
    const reason = lockReasonOf(me);
    if (reason) {
      myLockedAtRef.current = Date.now();
      setLockReason(reason);
    }
  }, [me, lockReason]);

  // Schedule 'converge' at the reason-appropriate delay — exactly once per lock.
  useEffect(() => {
    if (lockReason === null || convergeArmedRef.current) return;
    convergeArmedRef.current = true;
    timersRef.current.push(setTimeout(() => setResultPhase('converge'), REASON_DELAY_MS[lockReason]));
  }, [lockReason]);

  // Once 'converge' lands, schedule 'reveal'/'final' either straight through (opponent already
  // locked) or held until an effect observes their `locked` flip true — re-checked on every
  // gameState update while held, firing exactly once via `revealArmedRef`.
  useEffect(() => {
    if (resultPhase !== 'converge' || revealArmedRef.current) return;
    if (!opp?.locked) return; // still held — re-runs on the next gameState update
    revealArmedRef.current = true;
    timersRef.current.push(setTimeout(() => setResultPhase('reveal'), REVEAL_AFTER_CONVERGE_MS));
    timersRef.current.push(setTimeout(() => setResultPhase('final'), REVEAL_AFTER_CONVERGE_MS + FINAL_AFTER_REVEAL_MS));
  }, [resultPhase, opp?.locked]);

  // A new match starts its own sequence — reset the baseline so a prior match can't leak state in.
  // `prevMatchIdRef` starts at the sentinel `undefined` (not `null`) specifically so this does NOT
  // fire on first mount — a real scenario (reconnecting mid-match, already locked) must let the
  // lock-detection effect above correctly arm off gameState that's already present on the very
  // first render, rather than this effect immediately stomping it back to null.
  const prevMatchIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevMatchIdRef.current;
    prevMatchIdRef.current = props.currentMatchId;
    if (prev !== undefined && props.currentMatchId && props.currentMatchId !== prev) {
      setLockReason(null);
      setResultPhase('idle');
      myLockedAtRef.current = null;
      convergeArmedRef.current = false;
      revealArmedRef.current = false;
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    }
  }, [props.currentMatchId]);
  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  // Live at render time, never a captured snapshot — the count only ever reflects what the server
  // has ACTUALLY sent (may still be `undefined` for the opponent briefly after 'converge' fires, if
  // their own round somehow hadn't resolved yet; `GemCountRow` simply renders nothing until then).
  const myGemCount = me?.uncovered?.length ?? 0;
  const oppGemCount = opp?.score ?? 0;

  return (
    <GameHub
      gameId="mines"
      gameName="Mines"
      renderGameArea={MinesPanel}
      // Ticket 2026-09-11#10 item 1: Mines measures the real bar-slide magnitude live, matching the
      // prototype's own `startMines()` (`Full Spec.html:3341-3348`) — never the flat ±123px RPS uses.
      matchBarSlide="measured"
      suppressResultOverlay
      ownBarResult
      // Ticket 2026-09-16#7 item 4: extends the shared `barSlideActive` (bar-shift + board-dim)
      // with this new post-lock window — see `GameHubProps.resultConverge`'s own doc comment.
      // Ticket 2026-09-17#4 (dismiss): excludes the new 'closed' phase (alongside 'idle') so
      // bar-shift, board-dim, and the VS label (all of which key off this prop, not `resultPhase`
      // directly) release automatically once dismissed — no separate wiring needed for any of them.
      resultConverge={resultPhase === 'converge' || resultPhase === 'reveal' || resultPhase === 'final'}
      // Ticket 2026-09-17#1 item 2: computed FRESH on every render, not a fixed constant. GameHub's
      // own match-end effect reads whatever this equals at the EXACT render where the match truly
      // ends (both players locked) — which, by construction, is no earlier than the moment the
      // opponent's own `locked` becomes visible to us. A ref set by a separate "release" effect
      // would race against that consuming effect (children's effects fire before a parent's own, so
      // GameHub's read could run before this component's own effect had a chance to update a ref) —
      // a pure per-render function sidesteps the race entirely: it's always correct for THIS render,
      // whichever fires first. Two cases: still counting down to 'converge' → the full remaining
      // time from my own lock; 'converge' has (or is about to) land → a flat 1520ms (820+700) from
      // NOW, since whatever the actual wait for the opponent was, holdResultMs is only ever
      // consumed once they're already done. Reduces to exactly 3020ms at elapsed=0 for a bust with
      // the opponent already finished — today's exact old constant, a special case, not a rewrite.
      holdResultMs={(() => {
        if (lockReason === null || myLockedAtRef.current === null) return undefined;
        const elapsed = Date.now() - myLockedAtRef.current;
        const reasonDelay = REASON_DELAY_MS[lockReason];
        const totalMs = REVEAL_AFTER_CONVERGE_MS + FINAL_AFTER_REVEAL_MS;
        return elapsed < reasonDelay
          ? Math.max(0, reasonDelay + totalMs - elapsed)
          : totalMs;
      })()}
      // Ticket 2026-09-17#1 item 2: `resultPhase` alone is now sufficient — it's no longer possible
      // for `resultPhase` to be non-'idle' without a genuine lock having armed it, so the old
      // `didBust &&` prefix (now generalized to every lock reason, not just bust) was redundant.
      // Ticket 2026-09-17#4 (dismiss): 'closed' ADDED to the visible allowlist — this strip stays
      // populated after dismiss (Full Spec.html:3765, oppGemRowOp is 1 for mr === 'closed' too),
      // opposite direction from the own-caption fix below (that one hides on dismiss, this doesn't).
      oppGemRow={resultPhase !== 'idle' ? <GemCountRow count={oppGemCount} visible={resultPhase === 'reveal' || resultPhase === 'final' || resultPhase === 'closed'} /> : undefined}
      // Ticket 2026-09-17#1 item 3: live, unconditional — matches the prototype's own `minesGems`
      // binding directly to the opened-safe-tile count, no result-state involvement at all.
      // `GemCountRow`'s own `count <= 0 → null` already gives "fades in with the first gem" for
      // free. `transitionMs={280}`: the player's own row's cited duration, distinct from the
      // opponent's 320ms default (see `GemCountRow`'s own doc comment).
      ownGemRow={<GemCountRow count={myGemCount} visible transitionMs={280} />}
      // Ticket 2026-09-17#3 item 2: the gem-count CAPTION (oppGemText/myGemText,
      // Full Spec.html:3779/3781) — a genuinely separate mechanism from the icon strip above (it
      // sits OUTSIDE the bar box). Preserving the source's own asymmetry exactly: the opponent's
      // text is ALWAYS "N gems" (no singular case) — as of ticket 2026-09-21#2 (D31), the player's
      // own now matches: D31 explicitly asks to drop the singular "1 gem" form that 2026-09-17#3
      // deliberately ported from the prototype's own literal source at the time — a knowing
      // override of that earlier citation, not a correction of a misreading, applied as directed.
      // Both only exist once the result sequence has actually started (resultPhase !== 'idle')
      // — unlike ownGemRow above, which is live from the very start of the round; this caption is
      // NOT (myGemTextOp: mGrown, which requires mActive, :3781). Visibility timing differs
      // between the two sides: the opponent's caption waits for reveal (oppGemTextOp: mReveal,
      // :3780, same beat as its own icon row), the player's own shows from converge onward
      // (mGrown is true for the whole non-idle/non-closed window, :3781 — a real distinction
      // from the icon row, not a slot reused with different data).
      // Ticket 2026-09-17#4/#5 (dismiss): the caption doesn't derive from `resultConverge` — it
      // checks `resultPhase` directly, so it needs this correction of its own. `oppGemTextVisible`
      // needs NO change: it's an explicit allowlist that never included 'closed', so it already,
      // correctly, hides on dismiss by construction. `ownGemTextVisible` DOES need `'closed'`
      // excluded — its "allow except idle" pattern would otherwise stay true through 'closed' too,
      // and D27 is explicit the own caption fades out on dismiss.
      oppGemText={resultPhase !== 'idle' ? `${oppGemCount} gems` : undefined}
      oppGemTextVisible={resultPhase === 'reveal' || resultPhase === 'final'}
      ownGemText={resultPhase !== 'idle' ? `${myGemCount} gems` : undefined}
      ownGemTextVisible={resultPhase !== 'idle' && resultPhase !== 'closed'}
      // Ticket 2026-09-17#4 (dismiss): a tap anywhere in the game section dismisses a landed
      // result — see `GameHubProps.onSectionTap`'s own doc comment for the full scoping rationale
      // (narrower than the prototype's page-wide overlay, by design). No-ops unless the result has
      // actually landed ('final') — a tap during 'converge'/'reveal', or with no result at all, does
      // nothing.
      onSectionTap={() => {
        if (resultPhase === 'final') setResultPhase('closed');
      }}
      // Ticket 2026-09-21#10 (D37): hides the shared "Playing…" label the moment the opponent's
      // OWN round ends — see `GameHubProps.oppLocked`'s own doc comment for the full collision
      // this closes (the label used to linger through the whole post-lock holdResultMs window,
      // well past the opponent's gem strip already fading in in the same bar).
      oppLocked={opp?.locked ?? false}
      {...props}
    />
  );
}
