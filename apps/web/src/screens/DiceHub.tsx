import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { DiceView } from '../App.js';
import { useTheme } from '../lib/theme.js';
import { play } from '../lib/sound.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

/** Hundredths → "42.37". */
const fmtRoll = (roll: number): string => (roll / 100).toFixed(2);
/** Hold the board a beat after the server resolves so the rolls reveal before the overlay. */
const HOLD_MS = 2200;

/*
 * T6a — visual rebuild, ported from the prototype's `isDice` block: `design/prototype/RapidClash
 * Full Spec.html` lines 531-603 (markup) + the computed style props feeding it, lines 3605-3681 and
 * 3720-3725 (JS `getState`). Two horizontal roll gauges (opponent above, own below), a 0/25/50/75/100
 * scale between them, and a belt of the last 5 results sliding in from the right. Every color/timing/
 * spacing value below cites its exact source line. The mechanic (packages/games/dice/src/dice.ts —
 * independent seeded rolls, higher wins, exact tie → instant reroll) is UNTOUCHED — this is
 * presentation only.
 *
 * Reveal-timing note: the prototype's own reveal is client-SIMULATED — `startDice()` fakes both
 * rolls with `Math.random()` and counts them up over a 444ms rAF tween (lines 3420-3446) BEFORE the
 * numbers are "true". Our reveal is server-authoritative and redacted pre-terminal (dice.ts's
 * `viewFor`) — the real rolls only ever arrive already-decided, so there's no honest intermediate
 * value to count through (fabricating one would break this app's no-fabricated-data rule — see
 * GameHub.tsx's "never a fabricated/cycled name" precedent for the same principle elsewhere). This
 * port keeps the exact motion — the gauge fill/cube animate from empty/hidden to their landed
 * position over the SAME cited transitions — but always shows the true final number the instant it's
 * known; only the width/opacity/transform interpolate, via plain CSS transitions, not a JS counter.
 */

// ── Prototype-literal colors — fixed, never theme-dependent. The prototype's own `getState()`
// never varies these with `light` either. Reconciliation sweep (2026-09-11): `--brand-purple`
// now matches the prototype's `#8B45F0` exactly (was `#8140e2`, this app's own pre-existing,
// slightly different value) — the track's base pill below reads the token directly instead of
// a raw literal, now that they're the same value. ──
const DICE_FILL_GREEN = '#22C55E'; // lines 542, 575 — the roll-progress fill
const DICE_WIN_GREEN = '#16A34A'; // lines 556, 589, 3451, 3678-3679 — winning number / winning history pill
const DICE_LOSE_RED = '#DC2626'; // lines 3678-3679 — losing number color
const DICE_NEUTRAL_NUM = '#12121F'; // lines 556, 589, 3678-3679 — pre-final / tie number color
// The die cube's faces are a fixed light isometric gradient in EITHER theme (a physical die stays
// white) — lines 551-553 / 584-586.
const CUBE_FACE_A = '#EDF1F6';
const CUBE_FACE_B = '#D5DCE5';
const CUBE_FACE_C = '#FFFFFF';

// ── Theme-varying literals with no existing --rc-* match. Checked against index.css: `minesCardBg`
// (line 3720) DOES match `--rc-surface` exactly in both themes — reused as `bg-surface` below and in
// the belt's fade gradient. Neither `diceTrackBg` nor `minesBoardBg` matches any --rc-* pair, so they
// stay local, switched via `useTheme()` — the same per-screen pattern HubRibbon.tsx already uses for
// prototype literals scoped to one screen (its `logoUrl` ternary on `resolved === 'light'`). ──
const DICE_TRACK = { light: '#BFBFCE', dark: '#2F2F49' }; // line 3723 (`diceTrackBg`)
const DICE_GROOVE = { light: '#DEDEE8', dark: '#12121F' }; // line 3721 (`minesBoardBg`, shared by this block)

const DICE_SCALE = [0, 25, 50, 75, 100]; // line 3605
const SPACE_GROTESK = "'Space Grotesk', Arial, Helvetica, sans-serif"; // e.g. lines 556, 563, 589, 596

const FILL_TRANSITION = 'width 420ms cubic-bezier(0.4,0,0.2,1)'; // line 3675 (settled branch)
// Ticket 2026-09-12#5 item 3 (ADVISOR_TO_PM.md): `left` added to the prototype's own literal
// transition list (lines 543/576 cite only opacity/transform — the prototype instead re-renders
// `left` every rAF frame during its client-simulated 444ms count-up, `runDiceRoll`, :3432-3437, so
// it never needed a CSS transition on position). This app has no such per-frame loop (deliberately —
// no fabricated intermediate roll value, see this file's header comment), so a real CSS transition on
// `left` is the honest substitute: it interpolates POSITION only, between two always-true endpoints
// (0% at rest, the true final roll once known) — never an invented NUMBER. Same 420ms/easing as the
// existing `transform` entry, since both drive the same physical motion.
const CUBE_TRANSITION = 'opacity 300ms ease, transform 420ms cubic-bezier(0.2,1.2,0.35,1), left 420ms cubic-bezier(0.2,1.2,0.35,1)';
const NUM_COLOR_TRANSITION = 'color 260ms ease'; // lines 556, 589
const BELT_EASE: [number, number, number, number] = [0.3, 0.9, 0.32, 1]; // lines 3669, 3674
const BELT_DURATION_S = 0.46; // 460ms — lines 3669, 3674

interface HistoryPill {
  id: string;
  /** My roll, hundredths (e.g. 5000 → "50.00"). */
  value: number;
  win: boolean;
}

/** One isometric die-cube icon (lines 544-555 / 577-588) — a shared shape, only the mask id differs
 *  per instance so two can render side by side without colliding. */
function DieCubeIcon() {
  const maskId = useId();
  return (
    <svg viewBox="-5 -5 62 66" className="absolute inset-0 h-full w-full overflow-visible">
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="-20" y="-20" width="92" height="96">
          <path d="M26 0 L52 14 L52 42 L26 56 L0 42 L0 14 Z" fill="#fff" stroke="#fff" strokeWidth={7} strokeLinejoin="round" />
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>
        <path d="M-14 6.5 L26 28 L26 70 L-14 48.5 Z" fill={CUBE_FACE_A} />
        <path d="M26 28 L66 6.5 L66 48.5 L26 70 Z" fill={CUBE_FACE_B} />
        <path d="M26 -14 L66 6.5 L26 28 L-14 6.5 Z" fill={CUBE_FACE_C} />
      </g>
    </svg>
  );
}

/** One roll gauge — a horizontal pill track filling 0→rolled-value with the die riding the fill
 *  edge. `pos="opp"` mirrors `pos="mine"` (scale ticks + cube hang off the opposite edge, lines
 *  534-559 vs 567-592) so the two cubes converge toward the scale row between them.
 *
 *  Ticket 2026-09-12#5 item 3 (ADVISOR_TO_PM.md): `active` (new prop, true only from `DiceBoard`,
 *  false from `DiceIdle`'s preview) replaces gating cube visibility/scale on `roll != null`. Traced
 *  the prototype's own state machine, not just its markup: `diceCubeIn` (the real gate behind
 *  `diceMyOp`/`diceOppOp`/`diceCubeScale`, `:3612-3614`) flips true at the START of a roll —
 *  `this.setState({ diceMy: 0, diceOpp: 0, diceRolling: false, diceCubeIn: true })`, `:3421` —
 *  BEFORE `runDiceRoll`'s 444ms count-up even begins (`:3423`), not once it resolves. So the
 *  prototype's cube is visible, full-scale, and AT its (then-zero) position for the entire roll,
 *  not just a flash at the end — the count-up's per-frame `left` updates (no CSS transition needed
 *  there; the prototype re-renders it every rAF frame) are what makes it visibly travel. This app
 *  has no such frame loop (deliberate — see file header), so `left` is now a real CSS transition
 *  (`CUBE_TRANSITION` above) instead: the cube pops in at rest (0%, already `cubeLeft`'s existing
 *  `value ?? 0` fallback) the moment the board goes live, then visibly slides to its true endpoint
 *  once `roll` arrives — an honest position interpolation between two always-true points, never a
 *  fabricated intermediate NUMBER (the number label itself still only ever shows `fmtRoll(roll)`
 *  once `roll` is non-null, unchanged). */
function DiceTrack({ pos, roll, numColor, light, active }: { pos: 'opp' | 'mine'; roll: number | undefined; numColor: string; light: boolean; active: boolean }) {
  const isOpp = pos === 'opp';
  const trackColor = light ? DICE_TRACK.light : DICE_TRACK.dark;
  const grooveColor = light ? DICE_GROOVE.light : DICE_GROOVE.dark;
  const value = roll != null ? Math.max(0, Math.min(100, roll / 100)) : null;
  const fillWidth = value == null ? '50%' : `calc(10px + ${value} * (100% - 36px) / 100)`; // lines 3676-3677
  const cubeLeft = `calc(18px + ${value ?? 0} * (100% - 36px) / 100)`; // lines 3608-3609
  const cubeOpacity = active ? 1 : 0; // lines 3612-3613 (`diceCubeIn` — true for the WHOLE roll, not just once resolved)
  const cubeScale = active ? 'scale(1)' : 'scale(0.55)'; // line 3614 (same `diceCubeIn` gate)

  return (
    <div className="relative box-border h-[46px] rounded-full p-[11px]" style={{ background: trackColor }}>
      {/* Scale ticks — line 536-539 (opp, off the bottom edge) / 568-571 (mine, off the top edge). */}
      <div className="absolute left-[19px] right-[19px] flex justify-between" style={isOpp ? { bottom: '-5px' } : { top: '-5px' }}>
        {DICE_SCALE.map((v) => (
          <div
            key={v}
            style={{
              width: 0,
              height: 0,
              borderLeft: '7px solid transparent',
              borderRight: '7px solid transparent',
              ...(isOpp ? { borderTop: `6px solid ${trackColor}` } : { borderBottom: `6px solid ${trackColor}` }),
            }}
          />
        ))}
      </div>
      <div className="relative h-full rounded-full" style={{ background: grooveColor }}>
        {/* The always-full base pill — lines 541, 574. */}
        <div className="absolute inset-2 rounded-full" style={{ background: 'var(--brand-purple)' }} />
        {/* The roll-progress fill — lines 542/575 (color), 3675-3677 (width formula + transition). */}
        <div className="absolute bottom-2 left-2 top-2 rounded-full" style={{ background: DICE_FILL_GREEN, width: fillWidth, transition: FILL_TRANSITION }} />
        {/* The riding die — lines 543/576 (position/opacity/scale), 3608-3609 (position formula). */}
        <div
          data-testid={`dice-cube-${pos}`}
          className="absolute h-[56px] w-[52px] -ml-[26px]"
          style={{
            left: cubeLeft,
            ...(isOpp ? { bottom: 'calc(50% - 3px)', transformOrigin: '50% 100%' } : { top: 'calc(50% - 3px)', transformOrigin: '50% 0%' }),
            opacity: cubeOpacity,
            transform: cubeScale,
            transition: CUBE_TRANSITION,
          }}
        >
          <DieCubeIcon />
          <span
            className="absolute inset-0 flex items-center justify-center text-[13px] font-bold"
            style={{ fontFamily: SPACE_GROTESK, color: numColor, transition: NUM_COLOR_TRANSITION }}
          >
            {roll != null ? fmtRoll(roll) : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

/** The 0/25/50/75/100 scale row between the two tracks — line 561-565 (markup), 3605-3606 (values). */
function DiceScaleRow() {
  return (
    <div className="flex items-center justify-between px-[19px]">
      {DICE_SCALE.map((v) => (
        <div key={v} className="flex w-[14px] justify-center">
          {/* `diceScaleFg` (line 3606) is EXACTLY `--rc-text`'s light/dark pair — reused directly. */}
          <span className="whitespace-nowrap text-[12px] font-bold text-[var(--rc-text)]" style={{ fontFamily: SPACE_GROTESK }}>
            {v}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The last-5-results belt sliding in from the right — lines 593-601 (markup), 3658-3674 (choreography).
 *  `flex-direction: row-reverse` + a newest-first array puts the newest pill at the right edge, exactly
 *  like the prototype's own `row-reverse` + `[pill].concat(history)` unshift. Framer Motion's `layout` +
 *  `AnimatePresence` replaces the prototype's manual two-phase shift-state trick (`diceBeltShift`) for
 *  the same visual result — the oldest pill (once a 6th is pushed, line 3455's `.slice(0, 6)`) shrinks
 *  and fades off the left edge under `overflow-hidden` instead of getting explicitly hidden by index. */
function DiceHistoryBelt({ history, light }: { history: HistoryPill[]; light: boolean }) {
  return (
    <div className="relative mt-auto overflow-hidden">
      <div className="flex flex-row-reverse flex-nowrap gap-2 px-[22px]">
        <AnimatePresence initial={false}>
          {history.map((h) => {
            // Win pill color never varies with theme (line 3451); the loss pill is re-tinted for
            // contrast in light mode (lines 3663-3666) — its light bg is literally `diceTrackBg`'s
            // light value, reused here rather than duplicated.
            const bg = h.win ? DICE_WIN_GREEN : light ? DICE_TRACK.light : DICE_TRACK.dark;
            const fg = h.win ? '#FFFFFF' : light ? '#1A1A2E' : '#FFFFFF';
            return (
              <motion.div
                key={h.id}
                layout
                initial={{ scale: 0.45, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.45, opacity: 0 }}
                transition={{ duration: BELT_DURATION_S, ease: BELT_EASE }}
                style={{
                  flex: '0 0 calc((100% - 32px) / 5)', // line 596 — 5 pills visible
                  height: 28,
                  borderRadius: 999,
                  background: bg,
                  color: fg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: SPACE_GROTESK,
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {fmtRoll(h.value)}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      {/* Left/right fade masks — 24px wide, fading `minesCardBg` (== `--rc-surface`) to transparent
          (lines 599-600, 3724-3725) — same idiom as AffiliateHub.tsx's `onRailScroll` fades
          (`linear-gradient(to right, var(--rc-bg) 0%, var(--rc-bg) 12%, transparent 100%)`). */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-6" style={{ background: 'linear-gradient(to right, var(--rc-surface) 0%, var(--rc-surface) 40%, transparent 100%)' }} />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-6" style={{ background: 'linear-gradient(to left, var(--rc-surface) 0%, var(--rc-surface) 40%, transparent 100%)' }} />
    </div>
  );
}

/** Idle preview — mirrors RpsIdle / MinesIdle / CoinflipIdle's "anchor" convention (this screen
 *  used to show a plain 🎲 + caption instead; T6a replaces it with the real gauges so the idle
 *  state previews the actual board). Full brightness, not dimmed: the prototype's own idle-state
 *  opacity for this panel (`minesBoardOp`, shared property name, also drives the Dice panel at
 *  `Full Spec.html:532`) is `rpsMatching || mConverged ? 0.28 : 1` (`:3756`) — outside
 *  matching/converged (plain idle), that's `1`; there is no dimmed-idle state for Dice at all.
 *  Nor is there any idle caption — the prototype's `isDice` idle block (`:531-604`) is just the two
 *  tracks + scale row + history belt, no copy (same redundant-idle-text cleanup already applied to
 *  RPS #551 and Mines #555). Sized to the prototype's own fixed box (`height:266px;
 *  padding:20px 16px; padding-top:47px; justify-content:flex-start`, `:532-604`'s one wrapper div
 *  spanning both idle and live states, no inner split) — see `DiceBoard`'s identical box below.
 *
 *  Ticket 2026-09-12#5 item 2 (ADVISOR_TO_PM.md): fades this box to 28% opacity while
 *  `barSlideActive` — the same matching-phase table-dim RPS (#551) and Mines (#555) already got,
 *  never applied here (`minesBoardOp`, the shared property name that also drives this panel,
 *  `Full Spec.html:3756`). Applied directly to this `hub-board` div (rather than a separate outer
 *  wrapper, the way `RpsPanel`/`MinesPanel` do it) since Dice's idle/board split has no such wrapper
 *  today and `hub-board` is already the single element every existing box-model test queries. */
function DiceIdle({ light, barSlideActive }: { light: boolean; barSlideActive?: boolean }) {
  return (
    <div
      data-testid="hub-board"
      className="flex h-[266px] flex-col justify-start gap-3.5 rounded-[22px] bg-surface px-4 py-5"
      style={{ paddingTop: 47, opacity: barSlideActive ? 0.28 : 1, transition: 'opacity 380ms ease' }}
    >
      <div className="flex flex-col gap-3.5">
        <DiceTrack pos="opp" roll={undefined} numColor={DICE_NEUTRAL_NUM} light={light} active={false} />
        <DiceScaleRow />
        <DiceTrack pos="mine" roll={undefined} numColor={DICE_NEUTRAL_NUM} light={light} active={false} />
      </div>
    </div>
  );
}

/** The live Dice area: both players auto-commit a `reveal` (no decisions), then the higher of two
 *  independent rolls wins. Neither roll is shown until the simultaneous reveal (server redaction). */
function DiceBoard({ gameState, legalMoves, onMove, playerId, opponentId, history, light, barSlideActive }: GameAreaArgs & { history: HistoryPill[]; light: boolean }) {
  const view = gameState as DiceView | null;
  const me = playerId, opp = opponentId;
  const result = view?.result;
  const myRoll = me ? result?.rolls?.[me] : undefined;
  const oppRoll = opp ? result?.rolls?.[opp] : undefined;
  const resolved = Boolean(result);

  // No decisions: auto-commit the reveal as soon as the server offers it. Gating on legalMoves
  // (cleared optimistically on send, re-armed by the next match's your_turn) sends it exactly once.
  const canReveal = legalMoves.includes('reveal');
  useEffect(() => { if (canReveal) onMove('reveal'); }, [canReveal, onMove]);

  const meWon = resolved && myRoll != null && oppRoll != null && myRoll > oppRoll;
  const oppWon = resolved && myRoll != null && oppRoll != null && oppRoll > myRoll;
  const tie = resolved && myRoll != null && oppRoll != null && myRoll === oppRoll;
  // lines 3678-3679: neutral pre-final/tie, else green for the higher roll, red for the lower.
  const myNumColor = tie ? DICE_NEUTRAL_NUM : meWon ? DICE_WIN_GREEN : oppWon ? DICE_LOSE_RED : DICE_NEUTRAL_NUM;
  const oppNumColor = tie ? DICE_NEUTRAL_NUM : oppWon ? DICE_WIN_GREEN : meWon ? DICE_LOSE_RED : DICE_NEUTRAL_NUM;

  return (
    // Same fixed box as `DiceIdle` above — the prototype's `isDice` wrapper (`:532-604`) is ONE div
    // spanning both idle and live states, not two differently-sized ones. Same item-2 opacity dim
    // as `DiceIdle` — `barSlideActive` is only ever true during the pre-match search/forming beat,
    // never simultaneously with a resolved result, so this never fights the result reveal.
    <div
      data-testid="hub-board"
      className="flex h-[266px] flex-col justify-start gap-3.5 rounded-[22px] bg-surface px-4 py-5"
      style={{ paddingTop: 47, opacity: barSlideActive ? 0.28 : 1, transition: 'opacity 380ms ease' }}
    >
      <DiceTrack pos="opp" roll={oppRoll} numColor={oppNumColor} light={light} active />
      <DiceScaleRow />
      <DiceTrack pos="mine" roll={myRoll} numColor={myNumColor} light={light} active />
      {/* Ticket 2026-09-15#10 item 1: a "You rolled higher!"/"Rolling…" status paragraph used to
          render here — zero occurrences anywhere in the prototype's own source (confirmed by
          direct grep), leftover copy this app added on its own. Removing it also frees up the
          vertical space the history belt's pills needed — this fixed-266px box had 5 flex children
          fighting for ~199px of content height with no shrink-0 guard; the status text was the
          overflow culprit for the pills rendering under their intended 28px size. */}
      <DiceHistoryBelt history={history} light={light} />
    </div>
  );
}

// Ticket 2026-09-12#5 item 1 (ADVISOR_TO_PM.md) — HIGH PRIORITY correction to #558: this used to
// gate on `phase === 'in-match'` only, so the instant `phase` became `'result'` (after HOLD_MS's
// 2200ms hold) the panel unmounted `DiceBoard` and swapped to the blank `DiceIdle` gauges —
// discarding the resolved cubes/history/status line right after they finally became visible. Fix:
// mirror `CoinflipPanel`'s own `live` gate exactly (`CoinflipHub.tsx:120`) — `DiceBoard` reads only
// `gameState`/`legalMoves` (never `phase` itself), so it renders the resolved roll correctly with
// no further changes needed there.
function DicePanel(args: GameAreaArgs & { history: HistoryPill[] }) {
  const { resolved: themeResolved } = useTheme();
  const light = themeResolved === 'light';
  const live = args.phase === 'in-match' || args.phase === 'result';
  return live ? <DiceBoard {...args} light={light} /> : <DiceIdle light={light} barSlideActive={args.barSlideActive} />;
}

/**
 * Dice Hub = the shared GameHub + the independent-roll area: each player auto-rolls one number
 * 0.00–99.99 from their OWN seed, higher wins. No decisions, no timer. The rolls, the seeds and the
 * resolution are all server-authoritative and hidden until the simultaneous reveal. See docs/DICE.md.
 *
 * `history` (the belt's last-5-results, T6a) is session-local state kept here — one level above the
 * board, which unmounts between matches (idle→waiting→in-match swaps DiceIdle/DiceBoard) — so it
 * survives across matches the same way the prototype's own `diceHistory` (also plain component state,
 * also never persisted) does. Appended once per resolved match, deduped by a round+rolls signature so
 * a re-render/reconnect replay of the SAME terminal state never double-pushes.
 */
export function DiceHubScreen(props: GameHubScreenProps) {
  const [history, setHistory] = useState<HistoryPill[]>([]);
  const lastSigRef = useRef<string | null>(null);
  const view = props.gameState as DiceView | null;

  useEffect(() => {
    const result = view?.result;
    const playerId = props.playerId;
    if (!view || !result || !playerId) return;
    const opp = view.players.find((p) => p !== playerId);
    const mine = result.rolls[playerId];
    const theirs = opp ? result.rolls[opp] : undefined;
    if (mine == null) return;
    const sig = `${playerId}:${result.round}:${mine}:${theirs}`;
    if (lastSigRef.current === sig) return;
    lastSigRef.current = sig;
    const win = theirs != null && mine > theirs;
    setHistory((h) => [{ id: sig, value: mine, win }, ...h].slice(0, 6)); // line 3455 — `.slice(0, 6)`
    // Ticket 2026-09-12#3 item 1: the prototype loops `dice-roll` from roll-start to resolution
    // (`this.sfx('dice-roll', true)` … `this.stopSfx('dice-roll')`, `Full Spec.html:3436/3469`).
    // `sound.ts`'s `play()` is a one-shot, fire-and-forget primitive with no loop/stop — building
    // one just for this single call site was judged not worth it (see ADVISOR_TO_PM.md
    // 2026-09-12#3 item 1's own recommendation). Since this reveal is server-authoritative (no
    // fabricated intermediate roll — see this file's header comment), the honest analog of "the
    // roll is happening" is this exact moment, once per newly-resolved match (deduped above).
    play('dice-roll');
    // `dice-win` is win-conditional only — the prototype's own asset set has no loss sound
    // (`if (win) this.sfx('dice-win')`, `Full Spec.html:3452`); do not add one for a loss.
    if (win) play('dice-win');
  }, [view, props.playerId]);

  const renderGameArea = useCallback((args: GameAreaArgs) => <DicePanel {...args} history={history} />, [history]);

  return (
    <GameHub
      gameId="dice"
      gameName="Dice"
      renderGameArea={renderGameArea}
      // Ticket 2026-09-12#3 item 3: opt into the shared own-bar win-fill mechanism (Coinflip's own
      // reference pattern, `CoinflipHub.tsx:339-341`) instead of the popup `DiceReveal` (now
      // deleted, dead once suppressResultOverlay is set) — the prototype's own `mOutcome` gate
      // (`gameV = view === 'mines' || isDice`, `Full Spec.html:3519`) explicitly includes Dice, and
      // Dice needs none of Mines' harder parts (bar-convergence/gem-text are both `!isDice`-gated).
      suppressResultOverlay
      ownBarResult
      holdResultMs={HOLD_MS}
      // Ticket 2026-09-11#10 item 1: Dice measures the real bar-slide magnitude live, matching the
      // prototype's own `startDice()` (`Full Spec.html:3396-3403`) — never the flat ±123px RPS uses.
      matchBarSlide="measured"
      {...props}
    />
  );
}
