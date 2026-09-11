import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { RpsView } from '../App.js';
import { useTheme } from '../lib/theme.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

const RPS_CHOICES = [
  { id: 'rock', emoji: '✊', label: 'Rock' },
  { id: 'paper', emoji: '✋', label: 'Paper' },
  { id: 'scissors', emoji: '✌️', label: 'Scissors' },
] as const;

/** T5's prototype-exact font override for "VS" text (`GameHub.tsx`'s own `ARIAL` const, mirrored
 *  here rather than imported — RPS's picker/reveal is a separate concern from T5's shared VS-label
 *  beat and this file must not reach into `GameHub.tsx` for it). Full Spec.html:617/3811-area VS
 *  labels use the same explicit Arial override as every other prototype-exact "VS" text. */
const ARIAL = 'Arial, Helvetica, sans-serif';

/** Cosmetic pick countdown length (seconds), display-only — mirrors `PICK_WINDOW_MS` (10_000) from
 *  `packages/games/rps/src/rps.ts` (NOT imported; the web app stays decoupled from the game
 *  packages, same as `CoinflipHub.tsx`'s `PICK_SECONDS`). The SERVER runs the authoritative clock;
 *  this only drives the digit-flip display. #164/#387: the round resolves ONLY at window expiry —
 *  this file never touches that model, it just paints the countdown toward it. */
const PICK_SECONDS = 10;

// ---- Prototype-exact geometry (Full Spec.html's `isRps` block, lines 605-658) ----------------
/** rpsCardW, non-expanded (Full Spec.html:3805). */
const CARD_W = 92;
/** rpsCardH, non-expanded (Full Spec.html:3806). */
const CARD_H = 130;
/** rpsGap, non-expanded (Full Spec.html:3804). */
const CARD_GAP = 36;
/** rpsVsW, non-expanded (Full Spec.html:3807). */
const VS_WIDTH = 56;

// ---- Prototype-exact colors --------------------------------------------------------------------
/** rpsLeftFrame / rpsRightFrame (Full Spec.html:3810-3811). Unlike every other RPS color in this
 *  block, these do NOT branch on `light` in the prototype's own source — they're a flat white
 *  photo-frame at rest and flat green/red/orange on a result, identical in both themes on purpose.
 *  Kept as literal hex (not `--rc-*` tokens) for exactly that reason — routing them through
 *  `--rc-green`/`--rc-danger` would make them theme-dependent, which the design source itself never
 *  is here. */
const FRAME_NEUTRAL = '#FFFFFF';
const FRAME_WIN = '#34D399';
const FRAME_LOSE = '#F04438';
const FRAME_DRAW = '#F79009';

function emojiFor(choice: string | undefined): string {
  return RPS_CHOICES.find((c) => c.id === choice)?.emoji ?? '?';
}

/** rpsTileBg (Full Spec.html:3819): the sunken tile behind each card's icon / each picker button.
 *  Theme-conditional in the prototype's own source (unlike the frame colors above), so this reads
 *  the resolved theme the same way the prototype's own `light` var does. No existing `--rc-*` token
 *  carries this exact pair (`--rc-sunken` is close but not equal — #0b0b0b/#d3d3dd vs this block's
 *  #12121F/#DEDEE8), so it's threaded locally rather than reused from a token with a different value.
 *
 *  A real hook — every caller in this file (`RpsIdle`, `RpsBoard`) is a mounted component, unlike the
 *  now-removed `RpsReveal`, which GameHub invoked as a plain callback during its OWN render and
 *  needed a non-hook twin to avoid attaching to GameHub's hook list (2026-09-11#10 item 2 deleted
 *  that component along with the now-unneeded plain `rpsTileBg()` variant). */
function useRpsTileBg(): string {
  const { resolved } = useTheme();
  return resolved === 'light' ? '#DEDEE8' : '#12121F';
}

/** One square "photo-frame" card: a colored outer frame (padding:6px, border-radius:14px, the
 *  `0 6px 16px rgba(0,0,0,0.28)` shadow) around a sunken inner tile (border-radius:9px). Matches
 *  Full Spec.html:609-610 (and the reveal's smaller :627/:632-633 pair) — the shared shape both the
 *  in-match cards and the result-reveal cards are built from. */
function RpsFrame({
  frame, tileBg, size, height, children, testid,
}: {
  frame: string;
  tileBg: string;
  size: number;
  height?: number;
  children: ReactNode;
  testid?: string;
}) {
  return (
    <div
      data-testid={testid}
      className="shrink-0 rounded-[14px] p-[6px] shadow-[0_6px_16px_rgba(0,0,0,0.28)] transition-[background] duration-[420ms] ease"
      style={{ width: size, height: height ?? size, background: frame }}
    >
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[9px]" style={{ background: tileBg }}>
        {children}
      </div>
    </div>
  );
}

/** Digit-flip countdown — mirrors the prototype's `rcClockOut`/`rcClockIn` keyframe pair
 *  (Full Spec.html:90-93). The outgoing digit slides down 26px, flashing through violet (#B285F7 at
 *  the 45% mark, Full Spec.html:90) before fading out at #8B45F0, 240ms cubic-bezier(0.33,0,0.67,0.35)
 *  (:90-91). The incoming digit slides up from -18px while fading in, 260ms
 *  cubic-bezier(0.3,0.9,0.32,1) (:92-93). The prototype re-triggers this every tick by alternating
 *  between two identical keyframe names (a CSS restart trick); Framer's keyed `AnimatePresence`
 *  gets the same per-tick replay for free. Font: Full Spec.html:620-621 (`'Space Grotesk'`, 26px,
 *  700, `var(--rc-text)`). */
function RpsCountdown({ seconds }: { seconds: number }) {
  return (
    <div
      className="relative h-[26px] w-[52px] overflow-hidden"
      role="timer"
      aria-label={`${seconds} seconds to pick`}
      data-testid="rps-countdown"
    >
      <AnimatePresence initial={false}>
        <motion.span
          key={seconds}
          className="absolute inset-0 flex items-center justify-center font-bold leading-none tabular-nums"
          style={{ fontFamily: "'Space Grotesk', " + ARIAL, fontSize: 26, color: 'var(--rc-text)' }}
          initial={{ y: -18, opacity: 0 }}
          animate={{ y: 0, opacity: 1, transition: { duration: 0.26, ease: [0.3, 0.9, 0.32, 1] } }}
          exit={{
            y: 26,
            opacity: 0,
            color: ['var(--rc-text)', '#B285F7', '#8B45F0'],
            transition: { duration: 0.24, ease: [0.33, 0, 0.67, 0.35], times: [0, 0.45, 1] },
          }}
        >
          {seconds}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

/** Idle/Waiting preview shown before a match starts. Full Spec.html's `isRps` block (:605-658) is
 *  ONE persistent panel — the two-card + VS frame (:608-641) sits directly above the picker grid
 *  (:643-654) with no `sc-if` between them, so the prototype shows both together at rest, not just
 *  once a match is live: `rpsBoardOp` (:606) gates the whole panel's visibility, not this row
 *  specifically, and `rpsChoicesOp`/`rpsChoicesPE` (:643) only ever dim/disable the picker grid.
 *  #512: this component (unlike `RpsBoard` below, T6b/#509) still only rendered the old plain grid
 *  with no card/VS frame above it — this reuses `RpsFrame`/`ARIAL`/the card constants T6b already
 *  added rather than duplicating that markup.
 *
 *  Idle variant of the frame: both cards render empty/placeholder (no pick exists yet — mirrors
 *  `rpsRock.op`/`rpsPaper.op`/`rpsScissors.op` and the opponent-side equivalents all sitting at 0 in
 *  the prototype's own at-rest state, :611-613/:634-636) and the digit-flip clock is omitted
 *  entirely rather than shown static-and-frozen — the prototype gates that clock's own box with
 *  `rpsClockOp`/`rpsClockScale` (:618) exactly because there's no live pick window to count down
 *  outside a match; `RpsBoard`'s live countdown only ever mounts once `phase === 'in-match'`. */
function RpsIdle({ phase }: { phase: GameAreaArgs['phase'] }) {
  const tileBg = useRpsTileBg();
  return (
    <div className="flex flex-col items-center gap-4 py-3">
      <div className="flex items-center justify-center" style={{ gap: CARD_GAP }}>
        <RpsFrame frame={FRAME_NEUTRAL} tileBg={tileBg} size={CARD_W} height={CARD_H} testid="hub-idle-my-pick">
          <span className="text-3xl opacity-0">•</span>
        </RpsFrame>
        <div className="flex shrink-0 items-center justify-center" style={{ width: VS_WIDTH }}>
          <span
            className="font-bold"
            style={{ fontFamily: ARIAL, fontSize: 16, letterSpacing: 1, color: '#FFFFFF' }}
          >
            VS
          </span>
        </div>
        <RpsFrame frame={FRAME_NEUTRAL} tileBg={tileBg} size={CARD_W} height={CARD_H} testid="hub-idle-opponent-pick">
          <span className="text-3xl">🤫</span>
        </RpsFrame>
      </div>

      <div className="grid w-full grid-cols-3 opacity-50" style={{ gap: 9 }}>
        {RPS_CHOICES.map((c) => (
          <div key={c.id} className="flex flex-col items-center gap-1 rounded-[16px] py-4" style={{ background: tileBg }}>
            <span className="text-3xl">{c.emoji}</span>
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{c.label}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {phase === 'waiting' ? 'Waiting for an opponent…' : 'Choose a bet and press PLAY, or JOIN an open challenge'}
      </p>
    </div>
  );
}

/**
 * The live in-match board (lifts Play.tsx's choice UI), now ALSO the terminal result presentation
 * (2026-09-11#10 item 2, ADVISOR_TO_PM.md) — this component stays mounted through 'in-match' AND
 * 'result' (see `RpsPanel` above), so the same DOM node carries the match from opening pick through
 * final reveal, matching the prototype exactly: there is no separate full-screen result modal for
 * this game anywhere in `Full Spec.html` — the persistent `isRps` block (:605-658) IS the result
 * screen too, just with `rpsLeftFrame`/`rpsRightFrame`/`rpsFlipRot` swapping from their at-rest
 * values to their outcome-colored ones (:3808-3810) in place.
 *
 * Redaction: your pick always shows; the opponent stays hidden (🤫) EXCEPT for two deliberate
 * reveal beats, both reusing the SAME `RpsRevealFlipCard` (Full Spec.html:625-637's 3D flip) at
 * different moments — see "Composing the two reveals" below:
 *   1. A brief beat right after a TIED round (2026-09-11#9 item 2) — non-terminal, auto-resets.
 *   2. The match's TERMINAL reveal (this ticket) — win/lose/void, gated on `outcome` (set only once
 *      the match actually ends, `GameHub.tsx`'s `areaArgs.outcome`), and persists (no reset) since
 *      there's no next round to reset into.
 *
 * Visual rebuild (T6b): two square "photo-frame" cards either side of a VS + digit-flip countdown
 * (Full Spec.html:605-658) — your card shows your live pick (an opacity/scale swap between the
 * three icons, Full Spec.html:611-613's `op`/`scale` treatment). At terminal, both frames also pick
 * up the outcome color (`myFrame`/`oppFrame` below, ported byte-for-byte from the now-removed
 * `RpsReveal` overlay component's identical formula — Full Spec.html:3808-3810's `rpsLeftFrame`/
 * `rpsRightFrame`: mine turns green/red/orange on win/lose/void, the opponent's only ever turns
 * orange on void, otherwise stays the neutral white frame both cards use pre-terminal).
 *
 * Composing the two reveals (a terminal outcome can never actually race a pending tie-reveal — the
 * tie-reveal window is `TIE_REVEAL_FLIP_MS + TIE_REVEAL_HOLD_MS` ≈ 2.3s, while the very next round's
 * EARLIEST possible resolution is a full fresh `PICK_WINDOW_MS` ≈ 10s later, since a round only ever
 * resolves at window expiry — `rps.ts`'s `resolve()`/`isLockTime()` — never early on "both chosen";
 * but this renders defensively rather than leaning on that timing margin alone, e.g. for a future
 * shortened test window): the terminal reveal ALWAYS wins the render over `tieReveal` state (see the
 * effect that clears any pending tie-reveal the instant `terminal` goes true, and the render's
 * `terminal ? … : tieReveal ? … : …` ordering below) — the two can never mount competing flips into
 * the same opponent-card slot.
 *
 * `suppressResultOverlay`/`ownBarResult` are wired on the `<GameHub>` call below (no `holdResultMs`
 * — see that call's comment for why RPS's short 820ms flip doesn't need Coinflip's artificial hold).
 *
 * Timer-only-resolve model (#164): the pick is CLIENT-LOCAL and FREELY CHANGEABLE for the whole
 * window — tapping a throw rings it PURPLE immediately (no wait for the server echo) and re-tapping
 * moves the selection. Buttons are NEVER gated by `legalMoves`/`your_turn` (all three stay legal all
 * window; the client ignores that churn). Every tap sends the replacement throw; the server locks
 * both at window expiry. No same-side/"taken-throw" restriction (it would leak the opponent's pick).
 * Once terminal, the grid locks (see `terminal` below) — there is no round left to pick into.
 */
function RpsBoard({ playerId, opponentId, gameState, events, onMove, onForfeit, username, outcome, serverClockOffset = 0 }: GameAreaArgs) {
  const view = gameState as RpsView | null;
  const tileBg = useRpsTileBg();
  // Terminal outcome (win/draw/void) — set by GameHub only once the match has actually ended
  // (`areaArgs.outcome`, null for the whole live match). Ported from the now-removed `RpsReveal`
  // overlay component's identical formula (Full Spec.html:3808-3810's `rpsLeftFrame`/`rpsRightFrame`).
  // RPS never actually produces a terminal `draw` (ties auto-replay server-side, `rps.ts`'s
  // `resolve()`) — only a decisive `win` or, at the replay cap, `void`; `void` gets the same neutral
  // "neither side" treatment `draw` would.
  const terminal = outcome != null;
  const mineWon = outcome?.type === 'win' && outcome.winner === playerId;
  const oppWon = outcome?.type === 'win' && outcome.winner !== playerId;
  const neutralOutcome = outcome?.type === 'draw' || outcome?.type === 'void';
  const myFrame = mineWon ? FRAME_WIN : oppWon ? FRAME_LOSE : neutralOutcome ? FRAME_DRAW : FRAME_NEUTRAL;
  const oppFrame = neutralOutcome ? FRAME_DRAW : FRAME_NEUTRAL;
  // The opponent's real throw — `viewFor` (rps.ts) stops redacting once the state is terminal, so
  // this is already the true value by the time `outcome` (and therefore `terminal`) arrives.
  const oppThrow = opponentId ? view?.choices?.[opponentId] : undefined;
  // Own throw is not redacted, but it trails the tap by a round-trip — the optimistic pick bridges it.
  const serverChoice = playerId ? view?.choices?.[playerId] : undefined;
  const [optimisticPick, setOptimisticPick] = useState<string | null>(null);
  // Clear the local pick when the round closes (round bumps on replay; choices clears) so the next
  // window opens blank.
  const round = view?.round;
  useEffect(() => {
    setOptimisticPick(null);
  }, [round]);
  const myChoice = optimisticPick ?? serverChoice;
  function handlePick(id: string) {
    setOptimisticPick(id);
    onMove(id);
  }

  // 2026-09-11#9 item 2 (deliberate, Owner-approved redaction rollback — see rps.ts's resolve()):
  // a tied round's `new_round` event carries `revealedChoices`, both players' real throws for the
  // round that just ended. Flip the opponent's card from the redacted 🤫 face to that real throw
  // (RpsRevealFlipCard's existing 820ms flip, Full Spec.html:625-637), hold it ~1.5s (matching the
  // prototype's own tie hold, Full Spec.html:3084-3099), then fall back to the redacted tile as the
  // fresh round's window opens (the `round` bump above already clears the optimistic pick then).
  const TIE_REVEAL_HOLD_MS = 1500;
  const TIE_REVEAL_FLIP_MS = 820;
  const [tieReveal, setTieReveal] = useState<{ seq: number; choice: string | undefined } | null>(null);
  const tieRevealSeq = useRef(0);
  const tieRevealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (tieRevealTimer.current) clearTimeout(tieRevealTimer.current); }, []);
  useEffect(() => {
    if (terminal) return; // match already over — no more rounds, nothing to tie-reveal.
    const newRound = events?.find((e) => e.type === 'new_round');
    const revealed = (newRound?.payload as { revealedChoices?: Record<string, string> } | undefined)?.revealedChoices;
    const oppChoice = opponentId ? revealed?.[opponentId] : undefined;
    if (!oppChoice) return; // not a tie's new_round (or no opponent id yet) — nothing to reveal.
    tieRevealSeq.current += 1;
    setTieReveal({ seq: tieRevealSeq.current, choice: oppChoice });
    if (tieRevealTimer.current) clearTimeout(tieRevealTimer.current);
    tieRevealTimer.current = setTimeout(() => setTieReveal(null), TIE_REVEAL_FLIP_MS + TIE_REVEAL_HOLD_MS);
  }, [events, opponentId, terminal]);
  // 2026-09-11#10 item 2: a terminal outcome always wins over any still-pending tie-reveal — see
  // "Composing the two reveals" in the doc comment above for why this can't actually race in
  // practice, and why this clears defensively anyway rather than relying on timing margin alone.
  useEffect(() => {
    if (!terminal) return;
    if (tieRevealTimer.current) { clearTimeout(tieRevealTimer.current); tieRevealTimer.current = null; }
    setTieReveal(null);
  }, [terminal]);

  // Cosmetic countdown, driven by the server's authoritative window close (`windowEndsAt`) when
  // present — accurate and RESTARTS automatically on each tie-replay round (re-stamped server-side).
  // Falls back to a static PICK_SECONDS if the field is absent. Mirrors CoinflipHub.tsx's identical
  // countdown effect one-for-one (same 10s model, same field).
  const windowEndsAt = view?.windowEndsAt;
  const [seconds, setSeconds] = useState(PICK_SECONDS);
  useEffect(() => {
    const tick = () => {
      if (windowEndsAt && windowEndsAt > 0) {
        const remaining = (windowEndsAt - (Date.now() + serverClockOffset)) / 1000;
        setSeconds(Math.max(0, Math.min(PICK_SECONDS, Math.ceil(remaining))));
      } else {
        setSeconds(PICK_SECONDS);
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [windowEndsAt, serverClockOffset]);

  return (
    <div className="flex flex-col items-center gap-4" data-testid="hub-board">
      {/* You — VS + countdown — Opponent (opponent hidden until the terminal reveal beat below).
          Full Spec.html:608 (gap), :616 (VS column width), :618 (countdown float). */}
      <div className="flex items-center justify-center" style={{ gap: CARD_GAP }}>
        <RpsFrame frame={terminal ? myFrame : FRAME_NEUTRAL} tileBg={tileBg} size={CARD_W} height={CARD_H}>
          <span
            className={cn(
              'text-3xl transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.34,1.7,0.5,1)]',
              myChoice ? 'scale-100 opacity-100' : 'scale-[0.4] opacity-0',
            )}
            data-testid="hub-my-pick-icon"
          >
            {myChoice ? emojiFor(myChoice) : '•'}
          </span>
        </RpsFrame>

        <div className="relative flex shrink-0 items-center justify-center" style={{ width: VS_WIDTH }}>
          <span
            className="font-bold"
            style={{ fontFamily: ARIAL, fontSize: 16, letterSpacing: 1, color: '#FFFFFF' }}
          >
            VS
          </span>
          {/* Full Spec.html:618 — a 52×52 box centred on the VS column, floated translateY(-42px)
              above it (rpsClockOp/rpsClockScale gate on the live pick window; here the board only
              ever mounts during that window, so the countdown is simply always shown). */}
          <div
            className="pointer-events-none absolute left-1/2 top-1/2"
            style={{ transform: 'translate(-50%, calc(-50% - 42px))' }}
          >
            <RpsCountdown seconds={seconds} />
          </div>
        </div>

        {terminal ? (
          // 2026-09-11#10 item 2: the match's terminal reveal, relocated in-place from the (now
          // removed) `RpsReveal` overlay component — same `RpsRevealFlipCard`, same 820ms flip
          // (Full Spec.html:625-637), just mounted on the persistent board instead of a popup. No
          // reset timer: unlike the tie-reveal beat below, this stays revealed — the match is over.
          <RpsRevealFlipCard
            key="terminal"
            frame={oppFrame}
            tileBg={tileBg}
            choice={oppThrow}
            size={CARD_W}
            height={CARD_H}
            testid="hub-opponent-pick-revealed"
          />
        ) : tieReveal ? (
          // 2026-09-11#9 item 2: a just-tied round's real opponent throw, flipped into view then
          // held before falling back to the redacted tile below — see the effect above.
          <RpsRevealFlipCard
            key={tieReveal.seq}
            frame={FRAME_NEUTRAL}
            tileBg={tileBg}
            choice={tieReveal.choice}
            size={CARD_W}
            height={CARD_H}
            testid="hub-opponent-pick-revealed"
          />
        ) : (
          <RpsFrame frame={FRAME_NEUTRAL} tileBg={tileBg} size={CARD_W} height={CARD_H}>
            {/* Redaction: never reveal the opponent's choice before match.end (or outside the
                tied-round reveal beat above). */}
            <span className="text-3xl" data-testid="hub-opponent-pick">🤫</span>
          </RpsFrame>
        )}
      </div>

      <p className="text-[11px] font-medium text-muted-foreground" data-testid="hub-my-pick">
        {username ? <>You (<strong className="text-foreground">{username}</strong>)</> : 'You'}
      </p>

      {/* Choice buttons — client-local, freely changeable for the whole window (never gated by
          legalMoves/your_turn). The selected throw rings the win-green ring (the selection
          language) — Full Spec.html:645-654 (grid gap:9px) + :3245's `ring` formula (`var(--rc-green)`
          resolves to the exact same #0B8F5A light / #34D399 dark pair that formula produces).
          Locks (dimmed + inert) once `terminal` — mirrors the prototype's own `rpsChoicesOp`/
          `rpsChoicesPE` dropping to 0.7/`none` outside the live 'run' phase (Full Spec.html:3809) —
          there is no round left to pick into, and CoinflipHub's `OwnPills` locks the same way at its
          own terminal (returning a static pill with no `onClick`). */}
      <div
        className={cn('grid w-full grid-cols-3 transition-opacity duration-300', terminal && 'opacity-70')}
        style={{ gap: 9 }}
        role="group"
        aria-label="RPS choices"
      >
        {RPS_CHOICES.map(({ id, emoji, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => handlePick(id)}
            disabled={terminal}
            aria-label={label}
            aria-pressed={myChoice === id}
            data-testid={`hub-move-${id}`}
            data-selected={myChoice === id || undefined}
            className="flex flex-col items-center gap-1 rounded-[16px] py-4 transition-[background,box-shadow] duration-200 ease-out hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:hover:brightness-100"
            style={{
              background: tileBg,
              boxShadow: myChoice === id ? 'inset 0 0 0 3px var(--rc-green)' : 'inset 0 0 0 3px transparent',
            }}
          >
            <span className="text-3xl">{emoji}</span>
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
          </button>
        ))}
      </div>

      {myChoice && !terminal && (
        <p className="text-center text-sm text-muted-foreground" data-testid="hub-locked">Picked {myChoice} — tap another to change, or wait for the timer</p>
      )}
      {/* Forfeit only makes sense mid-match — the match is already decided once terminal, and
          `onForfeit` has no live match left to act on. */}
      {!terminal && (
        <button type="button" onClick={onForfeit} className="pt-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
          Forfeit
        </button>
      )}
    </div>
  );
}

/** The RPS game-area slot: greyed idle preview, or the live board in-match. Full Spec.html:606 —
 *  border-radius:22px, background `minesCardBg` (light `#E9E9F0` / dark `#1A1A2E`, Full Spec.html:3720
 *  — the exact `--rc-surface` pair, so this reads the token instead of re-deriving the same value).
 *
 *  2026-09-11#10 item 2 (ADVISOR_TO_PM.md): also renders `RpsBoard` for the 'result' phase, not just
 *  'in-match' — `suppressResultOverlay` (wired below) means GameHub never swaps to a separate overlay
 *  at match.end, it just keeps rendering THIS slot with `phase` advanced to 'result' and `outcome`
 *  set. Mirrors `CoinflipPanel`'s identical `live = phase === 'in-match' || phase === 'result'` gate —
 *  the same persistent-board pattern, just spelled as a second phase check instead of a `live` const
 *  since RPS's idle/board split was already a ternary rather than one always-mounted subtree. */
function RpsPanel(args: GameAreaArgs) {
  const showBoard = args.phase === 'in-match' || args.phase === 'result';
  return (
    <div className="rounded-[22px] bg-[var(--rc-surface)] p-4">
      {showBoard ? <RpsBoard {...args} /> : <RpsIdle phase={args.phase} />}
    </div>
  );
}

/** The opponent's reveal card: a 3D flip from the redacted 🤫 face to the resolved throw, matching
 *  Full Spec.html:625-637 — `perspective:900px` (:625) on the frame, `rotateY(0 → 180deg)` over
 *  820ms `cubic-bezier(0.42,0.04,0.24,1)` (:626) on the inner flip, `backface-visibility:hidden` on
 *  both faces (:627/:632) so only one ever shows. Only the OPPONENT's card flips — my own choice was
 *  never hidden from me, so it renders resolved immediately (its frame just recolors — see
 *  `RpsBoard`'s own card above), the same asymmetry the prototype's own `rpsLeftFrame`/`rpsFlipRot`
 *  split encodes (only the right/opponent card carries `rpsFlipRot`).
 *
 *  `RpsBoard` is the only caller (2026-09-11#10 item 2 relocated this from a separate `RpsReveal`
 *  overlay component, since removed, into the persistent board itself) — both its tied-round reveal
 *  (2026-09-11#9 item 2) and its terminal reveal (this ticket) pass `CARD_W`/`CARD_H` explicitly so
 *  the card always matches the live board's own rectangular frame; no default size remains since
 *  there's no longer a separate, smaller overlay-card usage to default for. The flip itself plays
 *  once per MOUNT (fixed `initial`/`animate` values) — callers that need it to replay must remount
 *  via a changing `key`, which `RpsBoard` does per tie (the terminal reveal never needs to replay —
 *  it's keyed once and stays). */
function RpsRevealFlipCard({ frame, tileBg, choice, size, height, testid }: { frame: string; tileBg: string; choice: string | undefined; size: number; height: number; testid?: string }) {
  return (
    <div
      data-testid={testid}
      className="shrink-0 rounded-[14px] p-[6px] shadow-[0_6px_16px_rgba(0,0,0,0.28)] transition-[background] duration-[420ms] ease"
      style={{ width: size, height, background: frame, perspective: 900 }}
    >
      <motion.div
        className="relative h-full w-full"
        style={{ transformStyle: 'preserve-3d' }}
        initial={{ rotateY: 0 }}
        animate={{ rotateY: 180 }}
        transition={{ duration: 0.82, ease: [0.42, 0.04, 0.24, 1] }}
      >
        <div
          className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-[9px] text-2xl"
          style={{ background: tileBg, backfaceVisibility: 'hidden' }}
        >
          🤫
        </div>
        <div
          className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-[9px] text-2xl"
          style={{ background: tileBg, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          {emojiFor(choice)}
        </div>
      </motion.div>
    </div>
  );
}

/**
 * RPS Hub = the shared GameHub + an RPS play-panel (rock/paper/scissors + redaction), presenting
 * its result in place on the board itself rather than a separate pop-up.
 *
 * 2026-09-11#10 item 2 (ADVISOR_TO_PM.md): the prototype has NO separate full-screen result modal
 * for this game anywhere in `Full Spec.html` — win/lose is communicated entirely in-place, a green
 * fill + "you won" text fading in on the player's own bar (:662-663) plus the opponent's reveal card
 * 3D-flipping in place, same DOM node throughout. This hub now wires the same `suppressResultOverlay`
 * + `ownBarResult` pattern `CoinflipHub.tsx` already uses for exactly that (the working reference
 * implementation — `CoinflipHub.tsx:339-341`): GameHub never renders the separate `ResultOverlay`;
 * it holds the result phase open with `RpsBoard` still mounted (see `RpsPanel` above) so the terminal
 * reveal — relocated from the removed `RpsReveal` overlay component into `RpsBoard` itself — plays on
 * the board in place of a popup. The bar-level "You Win" fill is entirely generic `GameHub.tsx`
 * machinery (`ownBarResult`); no RPS-side work was needed for it.
 *
 * Deliberately NOT wiring `holdResultMs` (unlike Coinflip's `HOLD_RESULT_MS={2600}`): Coinflip needs
 * it because its coin's flip visual is gated on `gameState` directly (immediate at match end) while
 * `holdResultMs` only delays the BAR (`phase`/`outcome`, and therefore `ownBarResult`'s fill) behind
 * it, giving the ~1.8-2.4s coin flip room to land first. RPS's terminal reveal is gated on `outcome`
 * itself (see `RpsBoard`'s doc comment for why — `RpsView`'s client type carries no `winner` field to
 * derive it from `gameState` directly), so an added hold would delay the FLIP'S OWN START by the same
 * amount, not just the bar — doubling total reveal latency instead of sequencing it. Without a hold,
 * `outcome`/phase='result' land essentially the same tick the match ends (RPS had zero hold in the
 * old overlay path too, and that flip already played correctly), and `ownBarResult`'s fixed
 * `BAR_VERDICT_BEAT_MS` (250ms) delay plus its ~500ms fill-in already lands the bar's green fill at
 * ~750ms — just before the 820ms card flip finishes — a close, naturally-sequenced fit with no
 * artificial hold needed.
 */
export function RpsHubScreen(props: GameHubScreenProps) {
  return (
    <GameHub
      gameId="rps"
      gameName="Rock Paper Scissors"
      renderGameArea={RpsPanel}
      suppressResultOverlay
      ownBarResult
      // Ticket 2026-09-11#9 (ADVISOR_TO_PM.md), a DELIBERATE REVERSAL of #387's `searchFloorMs={0}`
      // above — not a regression, not new information #387 missed. #387's reasoning was real: RPS's
      // entire round IS the server's fixed 10s pick window (PICK_WINDOW_MS, `packages/games/rps/src/
      // rps.ts`'s `launch()`, resolves ONLY at expiry — never early), and `windowEndsAt` is stamped
      // at real match formation (`packages/core/src/matchmaking.ts`'s `joinQueue`/`takeChallenge`),
      // essentially the same instant `currentMatchId` reaches this client — so every ms this floor
      // holds `phase` at 'waiting' is a ms carved directly out of the player's SEEN, interactive share
      // of that already-ticking 10s window, not just a cosmetic pre-match delay. Owner directed this
      // reversal anyway, explicitly accepting that tradeoff: at this stage, matching the prototype's
      // ~3.8s search→found→split beat (`startRps()`, `Full Spec.html:3291-3313`) outweighs maximizing
      // the player's real picking time. In the common case (bot-crowd pairs near-instantly) this
      // leaves roughly 10 - 3.8 = ~6.2s of the window actually visible/tappable — the round itself is
      // NOT shortened (the server deadline is untouched, and the existing seeded auto-throw at
      // `windowEndsAt` — untouched by this change — still resolves gracefully if a player runs out of
      // visible time), only the player's own reaction window within it. Do not "fix" this back to 0
      // without Owner sign-off; see the mailbox entry for the full rationale.
      searchFloorMs={3800}
      // Ticket 2026-09-11#10 item 1: the flat-magnitude fallback the prototype's own `startRps()`
      // uses (it never measures the DOM, unlike `startMines()`/`startDice()`) — `Full Spec.html:3754`
      // (`!gameV` branch), `123`/`-123` for the opponent/player bar.
      matchBarSlide={123}
      {...props}
    />
  );
}
