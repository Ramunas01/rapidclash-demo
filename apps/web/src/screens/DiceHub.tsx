import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { DiceView } from '../App.js';
import { useTheme } from '../lib/theme.js';
import { play } from '../lib/sound.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

/** Hundredths → "42.37". */
const fmtRoll = (roll: number): string => (roll / 100).toFixed(2);

/*
 * T6a — visual rebuild, ported from the prototype's `isDice` block: `design/prototype/RapidClash
 * Full Spec.html` lines 531-603 (markup) + the computed style props feeding it, lines 3605-3681 and
 * 3720-3725 (JS `getState`). Two horizontal roll gauges (opponent above, own below), a 0/25/50/75/100
 * scale between them, and a belt of the last 5 results sliding in from the right. Every color/timing/
 * spacing value below cites its exact source line. The mechanic (packages/games/dice/src/dice.ts —
 * independent seeded rolls, higher wins, exact tie → instant reroll) is UNTOUCHED — this is
 * presentation only.
 *
 * Reveal-timing note (ticket 2026-09-16#4/D21, Owner-confirmed): the prototype's own reveal is
 * client-SIMULATED — `startDice()` fakes both rolls with `Math.random()` and counts them up over a
 * 444ms rAF tween (lines 3420-3446) BEFORE the numbers are "true". This app's reveal is
 * server-authoritative — the real rolls only ever arrive already-decided. Earlier revisions of this
 * file read that as reason enough to skip the counting animation entirely (snap straight to the
 * final state the instant data arrives) rather than risk fabricating an intermediate value. Owner
 * settled the actual question directly: the honest-data principle bars displaying a value that could
 * turn out wrong or inventing an event that never happened — it does NOT bar spending time revealing
 * an ALREADY-KNOWN-TRUE result dramatically. Counting up to a real number is theatre, not
 * fabrication, as long as nothing shown mid-count could turn out to be wrong. So this DOES now run a
 * real `requestAnimationFrame` counter (`DiceBoard`'s reveal-elapsed clock below) — every frame's
 * displayed number is the real final roll scaled by `runDiceRoll`'s own eased curve, mathematically
 * approaching (never exceeding, never inventing) the already-known-correct target.
 */
// ── Reveal choreography (Full Spec.html:3387-3459, `startDice`/`runDiceRoll`/`startDiceResult`) —
// the moment the server's real result is known, hold it back and reveal it on this exact timeline
// rather than snapping straight to it. ──
const REVEAL_SOUND_MS = 460; // `dice-roll` sound fires; both numbers begin counting up together
const REVEAL_COUNT_MS = 444; // `runDiceRoll`'s own count-up tween duration
const REVEAL_SETTLE_MS = REVEAL_SOUND_MS + REVEAL_COUNT_MS; // 904 — count lands exactly on the real numbers; colors resolve
const REVEAL_COMPLETE_MS = 1804; // 904+900 — bar ring/fill, history pill/belt-shift, and (win only) `dice-win` all fire together
/** `runDiceRoll`'s own eased curve (`Full Spec.html:3439-3442`) — `e = 1-(1-p)^3`. */
const revealEase = (p: number): number => 1 - (1 - p) ** 3;

// ── Prototype-literal colors — fixed, never theme-dependent. The prototype's own `getState()`
// never varies these with `light` either. Reconciliation sweep (2026-09-11): `--brand-purple`
// now matches the prototype's `#8B45F0` exactly (was `#8140e2`, this app's own pre-existing,
// slightly different value) — the track's base pill below reads the token directly instead of
// a raw literal, now that they're the same value. ──
const DICE_FILL_GREEN = '#22C55E'; // lines 542, 575 — the roll-progress fill
const DICE_WIN_GREEN = '#16A34A'; // lines 556, 589, 3451, 3678-3679 — winning number / winning history pill
// Ticket 2026-09-15#13 item 2: Designer overrides the prototype's own #DC2626 with the app-wide
// #FF3E5E loss red (same token as the bet-warning ring/player-bar loss ring) — deliberate, not a
// restore of the prototype's literal value.
const DICE_LOSE_RED = 'var(--rc-loss)'; // losing number color
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
// it never needed a CSS transition on position). At the time this app had no per-frame loop of its
// own, so a real CSS transition on `left` was the honest substitute: it interpolates POSITION only,
// between two always-true endpoints (0% at rest, the true final roll once known) — never an
// invented NUMBER. Same 420ms/easing as the existing `transform` entry, since both drive the same
// physical motion.
//
// Ticket 2026-09-21#3 item 2 (D32): `2026-09-16#4`/D21 later added exactly the per-frame reveal
// loop this comment originally said didn't exist (`revealedRoll()`'s rAF-driven `tick()`, below) —
// without anyone regating this transition for that new window. With `left` still transitioning
// unconditionally, the browser was perpetually smoothing toward a target `cubeLeft` that moved
// again every ~16ms before it could catch up — a real, visible lag behind the number label (which
// renders the same per-frame value directly, no CSS). `CUBE_TRANSITION_COUNTING` (no `left`,
// mirroring the prototype's own `diceFillTrans: diceRolling ? 'none' : ...`) is used instead
// exactly while that per-frame drive is active — opacity/transform are untouched by `roll` at all,
// so they keep transitioning smoothly regardless.
const CUBE_TRANSITION = 'opacity 300ms ease, transform 420ms cubic-bezier(0.2,1.2,0.35,1), left 420ms cubic-bezier(0.2,1.2,0.35,1)';
const CUBE_TRANSITION_COUNTING = 'opacity 300ms ease, transform 420ms cubic-bezier(0.2,1.2,0.35,1)';
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
 *  fabricated intermediate NUMBER.
 *
 *  Ticket 2026-09-21#3 (D32) item 1: the number label used to fall back to `''` whenever `roll` was
 *  `null` — but `roll` stays `null` for the whole server round-trip PLUS the reveal clock's first
 *  460ms, so the cube sat fully visible but textually blank for a real, noticeable stretch. Now
 *  matches `cubeLeft`/`fillWidth`'s own already-established resting fallback: `fmtRoll(0)` ("0.00")
 *  whenever the cube is `active` at all, blank only in the idle preview (`active` false) — the same
 *  honest "resting position" those two already commit to before a real roll exists, applied to the
 *  label too. Item 2: `counting` (new prop, threaded down from `DiceBoard`'s own reveal clock) gates
 *  `left`/`width`'s transitions off — see `CUBE_TRANSITION_COUNTING`'s own comment above for why. */
function DiceTrack({ pos, roll, numColor, light, active, counting = false }: { pos: 'opp' | 'mine'; roll: number | undefined; numColor: string; light: boolean; active: boolean; counting?: boolean }) {
  const isOpp = pos === 'opp';
  const trackColor = light ? DICE_TRACK.light : DICE_TRACK.dark;
  const grooveColor = light ? DICE_GROOVE.light : DICE_GROOVE.dark;
  // Ticket 2026-09-16#4 item 3: `roll == null` (no result yet, or the reveal hasn't started counting
  // yet — see DiceBoard's reveal clock) falls back to 0 for the POSITION formula — the prototype's
  // own `diceMyPos`'s `|| 0` (`:3608`) never distinguishes null from 0 either, so `cubeLeft` uses
  // this one shared fallback regardless of `active`.
  const value = roll != null ? Math.max(0, Math.min(100, roll / 100)) : 0;
  const cubeLeft = `calc(18px + ${value} * (100% - 36px) / 100)`; // lines 3608-3609
  // Ticket 2026-09-21#4 (D33): the FILL formula does NOT share that fallback in the prototype —
  // `diceMyFill` (`:3676`) is an explicit `== null ? '50%' : calc(...)`, genuinely diverging from
  // `diceMyPos` in the null case: true lobby idle (never searched, our `!active`) rests at a
  // neutral 50%, while an active-but-not-yet-rolled round (our `active`, prototype's own explicit
  // `diceMy = 0` reset at search-start, `:3410/:3422`) rests at the same near-empty nub `cubeLeft`
  // does. `2026-09-16#4`'s own comment (previously here) claimed these two formulas agreed at rest
  // — checked directly against the prototype's source and they don't; that fix correctly unified
  // the ACTIVE case but over-applied the same 0 fallback to the idle case too, which should have
  // kept the prototype's OTHER resting value instead. `active` is exactly this app's own equivalent
  // of the prototype's null-vs-0 distinction (`DiceIdle` passes false, `DiceBoard` passes true) —
  // no new state needed, just gate the existing prop.
  const fillWidth = active
    ? `calc(10px + ${value} * (100% - 36px) / 100)` // lines 3676-3677, diceMy === 0 branch
    : '50%'; // line 3676, diceMy == null branch — true idle only
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
        <div className="absolute bottom-2 left-2 top-2 rounded-full" style={{ background: DICE_FILL_GREEN, width: fillWidth, transition: counting ? 'none' : FILL_TRANSITION }} />
        {/* The riding die — lines 543/576 (position/opacity/scale), 3608-3609 (position formula). */}
        <div
          data-testid={`dice-cube-${pos}`}
          className="absolute h-[56px] w-[52px] -ml-[26px]"
          style={{
            left: cubeLeft,
            ...(isOpp ? { bottom: 'calc(50% - 3px)', transformOrigin: '50% 100%' } : { top: 'calc(50% - 3px)', transformOrigin: '50% 0%' }),
            opacity: cubeOpacity,
            transform: cubeScale,
            transition: counting ? CUBE_TRANSITION_COUNTING : CUBE_TRANSITION,
          }}
        >
          <DieCubeIcon />
          <span
            className="absolute inset-0 flex items-center justify-center text-[13px] font-bold"
            style={{ fontFamily: SPACE_GROTESK, color: numColor, transition: NUM_COLOR_TRANSITION }}
          >
            {active ? fmtRoll(roll ?? 0) : ''}
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
    <div data-testid="dice-history-belt" className="relative mt-auto overflow-hidden">
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

// Ticket 2026-09-21#6 (D35): `DiceIdle` and `DiceBoard` used to be two ENTIRELY SEPARATE React
// components, swapped by `DicePanel` on every `live` flip — CSS transitions cannot bridge an
// unmount/mount no matter what's declared on either side, so the cube/card opacity SNAPPED at
// exactly the two moments that mattered (a match starting, a replay/leave) instead of animating.
// Merged into ONE always-mounted component, matching the prototype's own single persistent
// `isDice` wrapper div — `active`/`roll`/card-opacity are now ordinary variables derived from
// `phase`/`gameState`, never a choice between two component trees. This alone makes every
// existing transition string here genuinely interpolate across every phase boundary, including
// ones that already had correct values (fixes the card's own opacity fade-in for free, and closes
// D34/2026-09-21#5's "belt missing from idle" gap for free too — there's only one branch to render
// it from now, so D34's own separate `DiceIdle` threading is superseded, not duplicated).
//
// Sized to the prototype's own fixed box (`height:266px; padding:20px 16px; padding-top:47px;
// justify-content:flex-start`, `Full Spec.html:532-604`) — no idle caption either (the prototype's
// own idle block is just the two tracks + scale row + history belt, no copy, matching the same
// redundant-idle-text cleanup RPS #551 and Mines #555 already got).
const CUBE_REVEAL_DELAY_MS = 660; // matches the bars' own 620ms slide-back transition (GameHub.tsx) + the prototype's own ~40ms scripted margin between mnM3 (shift ends, :3413) and mnM4 (diceCubeIn, :3421)

/** The Dice area — idle preview AND live board, one component. Both players auto-commit a
 *  `reveal` (no decisions) once live; the higher of two independent rolls wins. Neither roll is
 *  shown until the simultaneous reveal (server redaction).
 *
 *  Ticket 2026-09-16#4 item 1: once the server delivers the real result, it's held back from the
 *  rendered UI and revealed on the REVEAL_* timeline above — an rAF-driven elapsed-time clock
 *  (`revealElapsed`), re-armed once per genuinely new resolved round via `armedSig` (computed once,
 *  in `DiceHubScreen`, off the same dedup key that already gated the old instant history-push/sound
 *  effect). Sound (item 2) and the history push both fire off this same clock, exactly once per
 *  `armedSig`, tracked via a ref (not state) so the ~60fps rAF re-renders below don't re-fire them
 *  on stale closures. */
function DicePanel({
  gameState, legalMoves, onMove, playerId, opponentId, history, phase, barSlideActive, armedSig, pushHistory, onRevealComplete,
}: GameAreaArgs & { history: HistoryPill[]; armedSig: string | null; pushHistory(sig: string, mine: number, win: boolean): void }) {
  const { resolved: themeResolved } = useTheme();
  const light = themeResolved === 'light';
  const live = phase === 'in-match' || phase === 'result';

  // Ticket 2026-09-21#6 (D35) symptom 1: cubes used to pop in at the START of the bar-split (the
  // exact render `holdSearch` clears and `phase` flips to 'in-match' — `live` flips false→true in
  // that SAME render), not after it settles. The prototype gets its own gap for free because
  // `diceCubeIn:true` is a genuinely LATER, separate `setState` than the one ending the shift; our
  // simpler mechanism had no equivalent delay. `cubeActive` provides it: armed off `live`'s own
  // false→true edge, flips true only after CUBE_REVEAL_DELAY_MS, and resets the instant `live`
  // goes false again (so the NEXT match re-arms the same delay, not skips it).
  //
  // Initial values are seeded from `live` itself (not hardcoded false) — a component that mounts
  // ALREADY live (a page reload/reconnect mid-match, no bar-slide to wait out at all) must show
  // the cube immediately, not wait out an artificial delay meant for a genuine idle→in-match
  // transition observed WITHIN this component's own lifetime. Only that within-lifetime edge (the
  // effect's own `live && !wasLive.current` branch) ever arms the timer.
  const [cubeActive, setCubeActive] = useState(live);
  const wasLive = useRef(live);
  useEffect(() => {
    if (live && !wasLive.current) {
      wasLive.current = true;
      const t = setTimeout(() => setCubeActive(true), CUBE_REVEAL_DELAY_MS);
      return () => clearTimeout(t);
    }
    if (!live) {
      wasLive.current = false;
      setCubeActive(false);
    }
  }, [live]);
  // `active` (the same prop `DiceTrack` already reads for cube opacity/scale/label, AND — per
  // ticket 2026-09-21#4/D33 — the fill's near-empty-nub-vs-50% fallback) is now gated on the new
  // delay too, not just `live`. Deliberate simplification, documented rather than silent: the
  // prototype's own `diceMy`/`diceOpp` reset to 0 (which the FILL alone reacts to) happens earlier
  // than `diceCubeIn` (which only the CUBE's visibility reacts to) — a ~40ms gap between two
  // separate `setState` calls. Splitting that out here would need a second prop on `DiceTrack`
  // (fill-fallback timing vs. cube-visibility timing) for a difference on the order of tens of ms,
  // not the reported symptom (the cube popping in during the bar-split) — not worth the added
  // surface. The fill rests at 50% for the same ~660ms the cube is still hidden, then both switch
  // together; cosmetically negligible, and still strictly more honest than snapping either early.
  const active = live && cubeActive;

  // Gated on `live` (not just presence) explicitly, now that this component stays mounted through
  // idle/waiting too — `gameState`/`legalMoves` may still hold a previous match's stale values for
  // a render or two around a phase transition; reading them unconditionally (safe when this only
  // ever MOUNTED while live) would no longer be safe now that mounting isn't the guard.
  const view = live ? (gameState as DiceView | null) : null;
  const me = playerId, opp = opponentId;
  const result = view?.result;
  const myRoll = me ? result?.rolls?.[me] : undefined;
  const oppRoll = opp ? result?.rolls?.[opp] : undefined;

  // No decisions: auto-commit the reveal as soon as the server offers it. Gating on legalMoves
  // (cleared optimistically on send, re-armed by the next match's your_turn) sends it exactly once.
  const canReveal = live && legalMoves.includes('reveal');
  useEffect(() => { if (canReveal) onMove('reveal'); }, [canReveal, onMove]);

  // The elapsed-time clock. Idle (no armed round yet) → null, so every downstream computation below
  // falls back to "nothing revealed yet" without a separate idle branch. `Date.now()`, not the rAF
  // callback's own timestamp arg (which is a real, unfaked `performance.now()` under test) — same
  // convention CrashHub.tsx's own rAF clock already uses, for the same reason: fake-timer-testable.
  //
  // `sig` is paired with `elapsed` in ONE state update (not two separate state variables) to close
  // a real race: when `armedSig` changes (a fresh round arms while this component is already
  // mounted), React re-runs this effect in the SAME commit that updated `armedSig` — but the new
  // effect's first `requestAnimationFrame` callback hasn't fired yet, so a plain `elapsed`-only
  // state would still hold the PREVIOUS round's (possibly already-past-threshold) value for that one
  // commit, letting the sound/history effect below misfire against stale data. Pairing them lets the
  // derived `revealElapsed` below fall back to `null` whenever the sig doesn't match yet.
  const [reveal, setReveal] = useState<{ sig: string; elapsed: number } | null>(null);
  useEffect(() => {
    if (!armedSig) { setReveal(null); return; }
    let raf = 0;
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      setReveal({ sig: armedSig, elapsed });
      if (elapsed < REVEAL_COMPLETE_MS) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [armedSig]);
  const revealElapsed = reveal && reveal.sig === armedSig ? reveal.elapsed : null;

  // Sound (item 2) + history push, each exactly once per armedSig, at their own beat on the clock
  // above — replacing the old effect that fired both the instant `result` existed. The ref resets
  // itself (inline, guarded by the sig check) rather than during render, now that `revealElapsed`
  // itself can't go stale across an armedSig change (see above). Guarded on `myRoll`/`oppRoll`
  // (already gated on `live` above) so a stale `armedSig` surviving into idle can't double-push.
  const firedRef = useRef<{ sig: string | null; sound: boolean; complete: boolean }>({ sig: null, sound: false, complete: false });
  useEffect(() => {
    if (revealElapsed == null || !armedSig || myRoll == null || oppRoll == null) return;
    if (firedRef.current.sig !== armedSig) firedRef.current = { sig: armedSig, sound: false, complete: false };
    const fired = firedRef.current;
    if (revealElapsed >= REVEAL_SOUND_MS && !fired.sound) {
      fired.sound = true;
      play('dice-roll');
    }
    if (revealElapsed >= REVEAL_COMPLETE_MS && !fired.complete) {
      fired.complete = true;
      pushHistory(armedSig, myRoll, myRoll > oppRoll);
      // `dice-win` is win-conditional only — the prototype's own asset set has no loss sound
      // (`if (win) this.sfx('dice-win')`, `Full Spec.html:3452`); do not add one for a loss.
      if (myRoll > oppRoll) play('dice-win');
      onRevealComplete?.();
    }
  }, [revealElapsed, armedSig, myRoll, oppRoll, pushHistory, onRevealComplete]);

  // The number shown DURING the count is a REAL value mathematically approaching the already-known
  // target — never a value that could turn out wrong (see file header). Undefined (empty label,
  // resting position via DiceTrack's own item-3 fallback) before the count starts; the exact true
  // final value once it lands.
  function revealedRoll(finalRoll: number | undefined): number | undefined {
    if (finalRoll == null || revealElapsed == null || revealElapsed < REVEAL_SOUND_MS) return undefined;
    if (revealElapsed >= REVEAL_SETTLE_MS) return finalRoll;
    const p = (revealElapsed - REVEAL_SOUND_MS) / REVEAL_COUNT_MS;
    return Math.round(finalRoll * revealEase(p));
  }
  const myRollShown = revealedRoll(myRoll);
  const oppRollShown = revealedRoll(oppRoll);
  // Colors stay neutral through the whole count — confirmed against D21: "neutral during the count,
  // not before [the count lands]" — and resolve to green/red only once the numbers have settled.
  const numbersSettled = revealElapsed != null && revealElapsed >= REVEAL_SETTLE_MS;
  // Ticket 2026-09-21#3 item 2 (D32): true exactly while `revealedRoll()` is producing a new value
  // every rAF frame — see `CUBE_TRANSITION_COUNTING`'s own comment for why this needs to gate the
  // cube/fill's position transitions off during that window.
  const counting = revealElapsed != null && revealElapsed < REVEAL_SETTLE_MS;
  const meWon = numbersSettled && myRoll != null && oppRoll != null && myRoll > oppRoll;
  const oppWon = numbersSettled && myRoll != null && oppRoll != null && oppRoll > myRoll;
  const tie = numbersSettled && myRoll != null && oppRoll != null && myRoll === oppRoll;
  // lines 3678-3679: neutral pre-final/tie, else green for the higher roll, red for the lower.
  const myNumColor = tie ? DICE_NEUTRAL_NUM : meWon ? DICE_WIN_GREEN : oppWon ? DICE_LOSE_RED : DICE_NEUTRAL_NUM;
  const oppNumColor = tie ? DICE_NEUTRAL_NUM : oppWon ? DICE_WIN_GREEN : meWon ? DICE_LOSE_RED : DICE_NEUTRAL_NUM;

  return (
    // ONE persistent box across idle/waiting/in-match/result — the prototype's own `isDice`
    // wrapper (`:532-604`) is a single div spanning every state too, never two differently-sized
    // ones. `barSlideActive` is only ever true during the pre-match search/forming beat, never
    // simultaneously with a resolved result, so this never fights the result reveal.
    <div
      data-testid="hub-board"
      className="flex h-[266px] flex-col justify-start gap-3.5 rounded-[22px] bg-surface px-4 py-5"
      style={{ paddingTop: 47, opacity: barSlideActive ? 0.28 : 1, transition: 'opacity 380ms ease' }}
    >
      <DiceTrack pos="opp" roll={oppRollShown} numColor={oppNumColor} light={light} active={active} counting={active && counting} />
      <DiceScaleRow />
      <DiceTrack pos="mine" roll={myRollShown} numColor={myNumColor} light={light} active={active} counting={active && counting} />
      <DiceHistoryBelt history={history} light={light} />
    </div>
  );
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
  // Ticket 2026-09-16#4 item 1: the "is this round genuinely new" dedup key, now ARMING the reveal
  // (DiceBoard's own rAF clock) instead of firing the history push/sounds instantly — those now fire
  // off DiceBoard's own clock instead (REVEAL_SOUND_MS / REVEAL_COMPLETE_MS), via `armedSig` below.
  const [armedSig, setArmedSig] = useState<string | null>(null);
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
    setArmedSig(sig);
  }, [view, props.playerId]);

  // Called by DiceBoard's reveal clock at REVEAL_COMPLETE_MS — the SAME sig this effect just armed,
  // so a stray double-fire (there shouldn't be one) can't double-push: only the first call for a
  // given sig actually changes state.
  const pushHistory = useCallback((sig: string, mine: number, win: boolean) => {
    setHistory((h) => (h[0]?.id === sig ? h : [{ id: sig, value: mine, win }, ...h].slice(0, 6))); // line 3455 — `.slice(0, 6)`
  }, []);

  const renderGameArea = useCallback(
    (args: GameAreaArgs) => <DicePanel {...args} history={history} armedSig={armedSig} pushHistory={pushHistory} />,
    [history, armedSig, pushHistory],
  );

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
      // Ticket 2026-09-16#4 item 1: the bar ring/fill now waits for DiceBoard's own reveal-complete
      // signal (fired at REVEAL_COMPLETE_MS) instead of a fixed generic beat — same mechanism
      // BlackjackBoard already proved (`onRevealComplete`/`gateResultOnReveal`). `holdResultMs`
      // mirrors the same beat so `phase` reaches 'result' in lockstep with `revealDone`, rather than
      // the old fixed 2200ms (now redundant with — and slightly out of sync with — the reveal clock).
      gateResultOnReveal
      holdResultMs={REVEAL_COMPLETE_MS}
      // Ticket 2026-09-11#10 item 1: Dice measures the real bar-slide magnitude live, matching the
      // prototype's own `startDice()` (`Full Spec.html:3396-3403`) — never the flat ±123px RPS uses.
      matchBarSlide="measured"
      {...props}
    />
  );
}
