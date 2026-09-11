import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { Outcome } from '@rapidclash/shared';
import type { RpsView, GameView } from '../App.js';
import { useTheme, getResolvedTheme } from '../lib/theme.js';
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
/** The reveal's smaller pair of cards (result overlay is a compact `max-w-xs` modal — the full
 *  92×130 in-match size would not fit `ResultOverlay`'s card alongside the win/lose banner below
 *  it, GameHub.tsx:1177). Same radius/padding/shadow ratio, scaled down. */
const REVEAL_CARD = 64;

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
 *  Two forms: the hook re-renders on a live theme flip (for the always-JSX-mounted board/idle
 *  components below); the plain function reads the same module state without calling a hook, for
 *  `RpsReveal` — `GameHub.tsx` invokes `renderResultReveal` as a plain callback during its OWN
 *  render (`reveal={renderResultReveal?.({...})}`, not `<RpsReveal .../>`), so a hook call inside it
 *  would attach to GameHub's hook list instead of a real component's — exactly the "rendered more
 *  hooks than during the previous render" crash this avoids. */
function useRpsTileBg(): string {
  const { resolved } = useTheme();
  return resolved === 'light' ? '#DEDEE8' : '#12121F';
}
function rpsTileBg(): string {
  return getResolvedTheme() === 'light' ? '#DEDEE8' : '#12121F';
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
 * The live in-match board (lifts Play.tsx's choice UI). Pre-terminal only — your pick shows,
 * the opponent stays hidden (🤫); the terminal reveal happens in the result overlay at
 * match.end, so this never leaks the opponent's choice.
 *
 * Visual rebuild (T6b): two square "photo-frame" cards either side of a VS + digit-flip countdown
 * (Full Spec.html:605-658) — your card shows your live pick (an opacity/scale swap between the
 * three icons, Full Spec.html:611-613's `op`/`scale` treatment), the opponent's card stays the
 * redacted 🤫 tile for the whole window (its reveal is a separate beat — see `RpsReveal` below,
 * which owns the prototype's 3D card-flip, Full Spec.html:625-637). The pick-window MODEL is
 * unchanged: `windowEndsAt` only drives this cosmetic countdown, exactly the way
 * `CoinflipHub.tsx`'s `CountdownRing` already does for Coinflip's identical 10s window — the
 * server alone resolves the round, only ever at expiry (#164/#387).
 *
 * Timer-only-resolve model (#164): the pick is CLIENT-LOCAL and FREELY CHANGEABLE for the whole
 * window — tapping a throw rings it PURPLE immediately (no wait for the server echo) and re-tapping
 * moves the selection. Buttons are NEVER gated by `legalMoves`/`your_turn` (all three stay legal all
 * window; the client ignores that churn). Every tap sends the replacement throw; the server locks
 * both at window expiry. No same-side/"taken-throw" restriction (it would leak the opponent's pick).
 */
function RpsBoard({ playerId, gameState, onMove, onForfeit, username, serverClockOffset = 0 }: GameAreaArgs) {
  const view = gameState as RpsView | null;
  const tileBg = useRpsTileBg();
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
      {/* You — VS + countdown — Opponent (opponent hidden until the result overlay).
          Full Spec.html:608 (gap), :616 (VS column width), :618 (countdown float). */}
      <div className="flex items-center justify-center" style={{ gap: CARD_GAP }}>
        <RpsFrame frame={FRAME_NEUTRAL} tileBg={tileBg} size={CARD_W} height={CARD_H}>
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

        <RpsFrame frame={FRAME_NEUTRAL} tileBg={tileBg} size={CARD_W} height={CARD_H}>
          {/* Redaction: never reveal the opponent's choice before match.end. */}
          <span className="text-3xl" data-testid="hub-opponent-pick">🤫</span>
        </RpsFrame>
      </div>

      <p className="text-[11px] font-medium text-muted-foreground" data-testid="hub-my-pick">
        {username ? <>You (<strong className="text-foreground">{username}</strong>)</> : 'You'}
      </p>

      {/* Choice buttons — client-local, freely changeable for the whole window (never gated by
          legalMoves/your_turn). The selected throw rings the win-green ring (the selection
          language) — Full Spec.html:645-654 (grid gap:9px) + :3245's `ring` formula (`var(--rc-green)`
          resolves to the exact same #0B8F5A light / #34D399 dark pair that formula produces). */}
      <div className="grid w-full grid-cols-3" style={{ gap: 9 }} role="group" aria-label="RPS choices">
        {RPS_CHOICES.map(({ id, emoji, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => handlePick(id)}
            aria-label={label}
            aria-pressed={myChoice === id}
            data-testid={`hub-move-${id}`}
            data-selected={myChoice === id || undefined}
            className="flex flex-col items-center gap-1 rounded-[16px] py-4 transition-[background,box-shadow] duration-200 ease-out hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
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

      {myChoice && (
        <p className="text-center text-sm text-muted-foreground" data-testid="hub-locked">Picked {myChoice} — tap another to change, or wait for the timer</p>
      )}
      <button type="button" onClick={onForfeit} className="pt-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        Forfeit
      </button>
    </div>
  );
}

/** The RPS game-area slot: greyed idle preview, or the live board in-match. Full Spec.html:606 —
 *  border-radius:22px, background `minesCardBg` (light `#E9E9F0` / dark `#1A1A2E`, Full Spec.html:3720
 *  — the exact `--rc-surface` pair, so this reads the token instead of re-deriving the same value). */
function RpsPanel(args: GameAreaArgs) {
  return (
    <div className="rounded-[22px] bg-[var(--rc-surface)] p-4">
      {args.phase === 'in-match' ? <RpsBoard {...args} /> : <RpsIdle phase={args.phase} />}
    </div>
  );
}

/** The opponent's reveal card: a 3D flip from the redacted 🤫 face to the resolved throw, matching
 *  Full Spec.html:625-637 — `perspective:900px` (:625) on the frame, `rotateY(0 → 180deg)` over
 *  820ms `cubic-bezier(0.42,0.04,0.24,1)` (:626) on the inner flip, `backface-visibility:hidden` on
 *  both faces (:627/:632) so only one ever shows. Only the OPPONENT's card flips — my own choice was
 *  never hidden from me, so it renders resolved immediately (see `RpsReveal` below), the same
 *  asymmetry the prototype's own `rpsLeftFrame`/`rpsFlipRot` split encodes (only the right/opponent
 *  card carries `rpsFlipRot`). */
function RpsRevealFlipCard({ frame, tileBg, choice }: { frame: string; tileBg: string; choice: string | undefined }) {
  return (
    <div
      className="shrink-0 rounded-[14px] p-[6px] shadow-[0_6px_16px_rgba(0,0,0,0.28)] transition-[background] duration-[420ms] ease"
      style={{ width: REVEAL_CARD, height: REVEAL_CARD, background: frame, perspective: 900 }}
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

/** Result reveal: both choices, side by side (revealed by the server at terminal). Visual rebuild
 *  (T6b): the same photo-frame card language as the in-match board, colored by outcome —
 *  Full Spec.html:3810-3811's `rpsLeftFrame`/`rpsRightFrame` formulas (flat across both themes by
 *  the prototype's own design, see the `FRAME_*` constants' doc comment above). RPS never actually
 *  produces a terminal `draw` (ties auto-replay server-side, `packages/games/rps/src/rps.ts`'s
 *  `resolve()`) — only a decisive `win` or, at the replay cap, `void`. `void` gets the same orange
 *  "neither side" frame as `draw` would, matching `GameHub.tsx`'s own `ResultOverlay` which already
 *  groups draw/void into one neutral `kind`. */
function RpsReveal({ outcome, gameState, playerId }: { outcome: Outcome; gameState: GameView | null; playerId: string | null }) {
  const view = gameState as RpsView | null;
  const tileBg = rpsTileBg(); // NOT the hook — see its doc comment (GameHub calls this as a plain fn)
  if (!view || !playerId) return null;
  const opp = view.players.find((p) => p !== playerId);
  const mine = view.choices?.[playerId];
  const theirs = opp ? view.choices?.[opp] : undefined;
  if (!mine && !theirs) return null;

  const mineWon = outcome.type === 'win' && outcome.winner === playerId;
  const oppWon = outcome.type === 'win' && outcome.winner !== playerId;
  const neutral = outcome.type === 'draw' || outcome.type === 'void';
  const myFrame = mineWon ? FRAME_WIN : oppWon ? FRAME_LOSE : neutral ? FRAME_DRAW : FRAME_NEUTRAL;
  const oppFrame = neutral ? FRAME_DRAW : FRAME_NEUTRAL;

  return (
    <div className="mb-3 flex items-center justify-center" style={{ gap: 12 }} data-testid="hub-result-rps">
      <RpsFrame frame={myFrame} tileBg={tileBg} size={REVEAL_CARD}>
        <span className="text-2xl">{emojiFor(mine)}</span>
      </RpsFrame>
      <span className="font-bold text-muted-foreground" style={{ fontFamily: ARIAL, fontSize: 14, letterSpacing: 1 }}>VS</span>
      <RpsRevealFlipCard frame={oppFrame} tileBg={tileBg} choice={theirs} />
    </div>
  );
}

/**
 * RPS Hub = the shared GameHub + an RPS play-panel (rock/paper/scissors + redaction) and a
 * both-choices reveal in the result overlay. RPS keeps its mechanic / WS flow / redaction.
 */
export function RpsHubScreen(props: GameHubScreenProps) {
  return (
    <GameHub
      gameId="rps"
      gameName="Rock Paper Scissors"
      renderGameArea={RpsPanel}
      renderResultReveal={RpsReveal}
      // #387: RPS's entire round IS the server's fixed 10s pick window (PICK_WINDOW_MS, resolves
      // ONLY at expiry) — the default ~2.4s "Searching…" dwell floor could burn enough of it that
      // the throw buttons never render before the window elapses. Zero hold here maximizes the
      // player's real share of that window; every other hub game keeps the default.
      searchFloorMs={0}
      {...props}
    />
  );
}
