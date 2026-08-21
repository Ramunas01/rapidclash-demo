import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { CoinflipView } from '../App.js';
import { Coin, COIN_FACE_TOKENS } from '../components/coin/Coin.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

// Cosmetic pick countdown (seconds). Mirrors the coinflip module's `moveTimeoutMs` (10s) — the
// SERVER runs the authoritative clock + seeded auto-pick; this is display-only (the Keno/Limbo
// pattern). Kept local so the web app stays decoupled from the game packages.
const PICK_SECONDS = 10;
/** Hold the board mounted after match.end so the reveal stages: terminal frame (flip + opponent
 *  reveal) plays during the hold, then `outcome` arrives at the result phase and lights the outline.
 *  Bumped from 1500 → 2600 (COINFLIP_COIN.md flag #2): the 3D coin's flip now runs up to ~2.4s (vs the
 *  old flat coin's 1.1s), so the win/lose bar verdict must not light before the coin visually lands. */
const HOLD_RESULT_MS = 2600;

/** Coin render size (px) — the canvas size passed to <Coin>. REGRESSION FIX (ADVISOR_TO_PM.md
 *  2026-07-10#3): coin polish v2 set this to 420, which — paired with the fov-17 telephoto framing
 *  (fills ~90% of its own canvas, unchanged/correct) — rendered a ~385px coin, but 420px is bigger
 *  than the ~390px-wide phone panel. Flexbox shrank the box's WIDTH to fit while its HEIGHT stayed
 *  420 (a non-square box), so the camera's fixed-aspect (1:1) render stretched into a vertical
 *  ellipse, AND the 420-tall box (plus the matching `min-h-[440px]` floor below) forced the whole
 *  board past a phone viewport, pushing PLAY/bet controls off-screen. 420→240 keeps the box within
 *  the panel width (so it's never squeezed non-square — see also Coin.tsx's `shrink-0` belt-and-
 *  suspenders) and renders a visible coin of ~215-220px at the same fov-17 ~90% fill ratio — much
 *  bigger than the pre-#212 ~93px, while keeping the board compact enough to fit one screen. Shared
 *  by both the idle hero and the in-match board.
 *
 *  RING-CLEARANCE FIX (ADVISOR_TO_PM.md 2026-07-10#4): 240 → 216 (~10% down). The centred coin's
 *  left edge grazed the pick-window CountdownRing (pinned `absolute left-3` on the board) on narrow
 *  phone-width boards. 216 renders a visible coin ≈195px — still large and present — while clearing
 *  the ring. Nothing else (min-h, fov-17 framing, shrink-0, colours/glow) changed. */
const COIN_SIZE_PX = 216;

// The H/T pick pills mirror the flat coin's face colours one-to-one (orange heads / card-back-blue
// tails) — the fill IS the identity cue. Token-driven, shared with FlatCoin (no hardcoded hex).
const SIDES = [
  { id: 'heads', label: 'Heads', face: COIN_FACE_TOKENS.heads.face },
  { id: 'tails', label: 'Tails', face: COIN_FACE_TOKENS.tails.face },
] as const;

/** The server's terminal frame carries the flip `result` (stripped pre-terminal by viewFor). */
function isTerminal(view: CoinflipView | null): boolean {
  return Boolean(view?.result);
}

/** Circular pick-deadline countdown (cosmetic — the server runs the authoritative `moveTimeoutMs`
 *  clock + seeded auto-pick). Sits to the left of the coin during the pick window. */
function CountdownRing({ seconds }: { seconds: number }) {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, seconds / PICK_SECONDS));
  return (
    <svg
      width={52}
      height={52}
      viewBox="0 0 48 48"
      data-testid="coin-countdown"
      role="timer"
      aria-label={`${seconds} seconds to pick`}
    >
      <circle
        cx={24}
        cy={24}
        r={r}
        fill="none"
        className="text-border"
        stroke="currentColor"
        strokeWidth={3}
      />
      <circle
        cx={24}
        cy={24}
        r={r}
        fill="none"
        className="text-brand"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - frac)}
        transform="rotate(-90 24 24)"
      />
      <text
        x={24}
        y={29}
        textAnchor="middle"
        className="fill-foreground text-[15px] font-black tabular-nums"
      >
        {seconds}
      </text>
    </svg>
  );
}

/**
 * The Coinflip game-area slot: ONE persistent `<Coin>` for every phase (idle/waiting/in-match/result).
 *
 * Issue #262. The panel used to ternary-swap between a separate `CoinflipIdle` and `CoinflipBoard`,
 * each independently rendering its own `<Coin>` — separate mounts, separate WebGL scenes rebuilt on
 * every idle↔in-match transition, and no captions to remove them here made pixel-identical centering
 * unguaranteed. Now the whole board — the fixed-min-height `items-center justify-center` box, the
 * countdown ring, the single `<Coin>` — is one JSX subtree that renders unconditionally; only the
 * ring's presence and the coin's `face` prop vary by phase, so the coin's element identity (and its
 * Three.js scene, built once in `Coin.tsx`'s mount-only effect) never changes across a phase
 * transition — only on true mount/unmount of the whole hub. This is also what makes the one-time intro
 * animation (Part 3, `Coin.tsx`) correct: it fires once per hub mount, not once per phase transition.
 *
 * No caption renders in any state (idle/waiting/in-match/result) — matchmaking feedback already lives
 * elsewhere (opponent bar "PLAYING…"/"Opponent", PLAY button "WAITING FOR AN OPPONENT…").
 *
 * Pick window: the coin + the circular countdown (H/T selection lives in the player's own slot pill —
 * see renderSlotAside). At terminal the coin flips to the revealed face. The opponent's pick and the
 * flip never exist on the client before match.end (redaction is server-side); the client only
 * choreographs the reveal beats. Scroll-safety: when the round resolves the board scrolls itself into
 * view (replacing the old self-dismissing overlay's reach). Borderless navy.
 */
function CoinflipPanel(args: GameAreaArgs) {
  const { phase, gameState, serverClockOffset = 0, drawBeat } = args;
  const live = phase === 'in-match' || phase === 'result';
  const view = gameState as CoinflipView | null;
  const terminal = isTerminal(view);
  const result = (view?.result as 'heads' | 'tails' | undefined) ?? null;
  // Flip-on-draw: a same-side draw is NOT terminal (it replays), but the coin must STILL flip. During
  // the shared draw beat, animate the just-drawn flip from the public `lastResult` snapshot. Once the
  // beat ends the fresh pick window takes over (countdown returns).
  const drawFlip = drawBeat
    ? ((view?.lastResult?.result as 'heads' | 'tails' | undefined) ?? null)
    : null;
  const revealing = terminal || drawFlip != null;
  // Resting (null → idle heads, and intro-eligible — Coin.tsx) everywhere except an active reveal.
  const coinFace = terminal ? result : drawFlip;

  // Cosmetic countdown, driven by the server's authoritative window close (`windowEndsAt`) when
  // present — so it is accurate and RESTARTS automatically on each tie-replay round (windowEndsAt is
  // re-stamped). Falls back to a plain local count if the field is absent. Stops at the lock. The
  // effect is unconditional (hook rules — this component now renders every phase) but no-ops outside
  // the live pick window.
  const windowEndsAt = view?.windowEndsAt;
  const [seconds, setSeconds] = useState(PICK_SECONDS);
  useEffect(() => {
    if (!live || terminal) return;
    const tick = () => {
      if (windowEndsAt && windowEndsAt > 0) {
        const remaining = (windowEndsAt - (Date.now() + serverClockOffset)) / 1000;
        setSeconds(Math.max(0, Math.min(PICK_SECONDS, Math.ceil(remaining))));
      } else {
        setSeconds((s) => Math.max(0, s - 1));
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [live, terminal, windowEndsAt, serverClockOffset]);

  // Scroll-safety: a round can resolve (win/lose OR draw) while the player is scrolled down at Open
  // Games. Bring the board into view on any reveal so the flip/outline reaches them (no-op if in view).
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live && revealing) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [live, revealing]);

  return (
    <div className="rounded-2xl bg-surface p-4">
      {/* Single fixed-min-height, centred box for every phase — the coin's centre never moves. The
       *  ring is `absolute … -translate-y-1/2` (non-displacing) and only shown during the live pick
       *  window; the pick pills live in the slot-aside mechanism (renderSlotAside), entirely outside
       *  this box — neither ever shifts the coin. */}
      <div
        ref={ref}
        className="relative flex min-h-[260px] items-center justify-center py-3"
        data-testid="hub-board"
      >
        {live && !revealing && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2">
            <CountdownRing seconds={seconds} />
          </div>
        )}
        {/* The one persistent coin — mounted once for the whole hub visit. `intro` plays its one-time
         *  tease-and-spin the first time it settles at rest (see Coin.tsx); it never replays while this
         *  element stays mounted, including returning to idle after a result. */}
        <Coin face={coinFace} size={COIN_SIZE_PX} intro />
      </div>
    </div>
  );
}

/** A filled side capsule: orange HEADS / blue TAILS (mirrors the flat coin). Always shows the face colour. Tappable in the
 *  pick window; static (locked) at the reveal. No dot icon — the fill IS the identity cue.
 *  `selected` rings the capsule in brand PURPLE — the selection language, kept distinct from the
 *  green/red/orange result rings (which act on the whole player bar, not the capsule). */
function SidePill({
  side,
  disabled,
  selected,
  onClick,
  testid,
}: {
  side: (typeof SIDES)[number];
  disabled?: boolean;
  selected?: boolean;
  onClick?: () => void;
  testid?: string;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick, disabled, 'aria-pressed': selected } : {})}
      data-testid={testid ?? `hub-move-${side.id}`}
      data-selected={selected || undefined}
      aria-label={side.label}
      className={cn(
        'flex items-center justify-center rounded-full px-3 py-1.5 text-[12px] font-extrabold uppercase tracking-wide text-white transition-all',
        onClick && 'disabled:cursor-not-allowed disabled:opacity-50',
        selected && 'ring-2 ring-brand ring-offset-2 ring-offset-surface'
      )}
      style={{ background: side.face }}
    >
      {side.label}
    </Tag>
  );
}

/** The own slot aside: H/T capsules to pick during the window; at reveal, the locked pick is shown
 *  flat (no capsule outline — the bar-level result handles the win/lose/draw signal).
 *
 *  Timer-only-resolve model (#164): the pick is CLIENT-LOCAL and FREELY CHANGEABLE for the whole
 *  window — the tapped side rings PURPLE **immediately** from local state (no wait for the server to
 *  echo `view.choices`), and tapping the other side just **moves** the outline. It is NEVER gated by
 *  `legalMoves`/`your_turn` (both sides stay legal all window, and the client ignores that churn
 *  regardless). The server is authoritative: every tap sends the replacement pick, and the flip
 *  fires only when the server locks both at window expiry. Picks are hidden, so an instant local
 *  highlight is safe. No same-side restriction — both pills always tappable (a "taken" side must
 *  never be blocked; it would leak the opponent's pick). */
function OwnPills({ args }: { args: GameAreaArgs }) {
  const { gameState, onMove, playerId, phase } = args;
  const view = gameState as CoinflipView | null;
  const terminal = isTerminal(view);
  // Own choice is NOT redacted by viewFor (only the opponent's is) — so this is the server-recorded
  // pick, just one round-trip behind the tap. The optimistic pick below bridges that gap.
  const myChoice = playerId
    ? (view?.choices?.[playerId] as 'heads' | 'tails' | undefined)
    : undefined;

  const [optimisticPick, setOptimisticPick] = useState<'heads' | 'tails' | null>(null);
  // Clear the optimistic pick when the round resolves (terminal — a decisive result OR a draw before
  // its auto-replay closes the pick window) OR when the round state is wiped (`gameState` → null on
  // PLAY / hub leave-enter), so a new round always opens blank with no stale highlight. The terminal
  // frame reads the server-recorded choice, so the outline never flickers during the reveal.
  useEffect(() => {
    if (terminal || view == null) setOptimisticPick(null);
  }, [terminal, view]);

  if (terminal) {
    // Locked result frame: show the chosen side flat — the bar carries the outcome signal.
    const side = SIDES.find((s) => s.id === myChoice);
    if (!side) return null;
    return <SidePill side={side} testid="coin-own-pick" />;
  }

  // The H/T selector lives in the pill ONLY during the live pick window — never on the idle tile.
  if (phase !== 'in-match') return null;

  // Local pick wins for the visual; the server echoes the latest replacement into `view.choices`.
  const selected = optimisticPick ?? myChoice ?? null;
  function handlePick(id: 'heads' | 'tails') {
    setOptimisticPick(id); // optimistic purple outline — moves freely on every re-tap
    onMove(id); // authoritative replacement pick (the server accepts a new pick all window)
  }

  return (
    <span className="flex items-center gap-1.5" role="group" aria-label="Pick a side">
      {SIDES.map((s) => (
        // Both pills stay tappable the whole window — tapping either just moves the purple outline.
        <SidePill
          key={s.id}
          side={s}
          selected={selected === s.id}
          onClick={() => handlePick(s.id)}
        />
      ))}
    </span>
  );
}

/** The opponent slot aside: shows "PLAYING…" during the blind pick window (correction 1 — the
 *  renderSlotAside callback always returns a React element so the GameHub fallback never fires;
 *  we render the tag explicitly). At terminal, the opponent's pick is staged from match.end. */
function OpponentPill({ args }: { args: GameAreaArgs }) {
  const { gameState, opponentId, phase, drawBeat } = args;
  const view = gameState as CoinflipView | null;
  const terminal = isTerminal(view);
  // The opponent's pick reveals at terminal AND during the draw beat (from the public lastResult —
  // that round is over, so it no longer hides anything). Otherwise it stays "PLAYING…".
  const oppChoice = terminal
    ? opponentId
      ? (view?.choices?.[opponentId] as 'heads' | 'tails' | undefined)
      : undefined
    : drawBeat && opponentId
      ? (view?.lastResult?.choices?.[opponentId] as 'heads' | 'tails' | undefined)
      : undefined;
  if (!terminal && !drawBeat) {
    if (phase !== 'in-match') return null;
    return (
      <span className="shrink-0 text-xs font-black uppercase tracking-wide text-foreground/70">
        PLAYING…
      </span>
    );
  }
  const side = SIDES.find((s) => s.id === oppChoice);
  if (!side) return null;
  return <SidePill side={side} testid="coin-opp-pick" />;
}

/**
 * Coinflip Hub = the shared GameHub + the flat-coin arena. Pick window: a circular countdown + H/T
 * in the player's own slot pill, picks hidden. Reveal staged client-side from match.end (opponent's
 * pick → coin flip → own-pill outline). No server/protocol/viewFor change beyond the module's opt-in
 * per-player pick timer + seeded auto-pick. See docs/COINFLIP_HUB.md.
 */
export function CoinflipHubScreen(props: GameHubScreenProps) {
  return (
    <GameHub
      gameId="coinflip"
      gameName="Coinflip"
      renderGameArea={CoinflipPanel}
      renderSlotAside={(args, side) =>
        side === 'own' ? <OwnPills args={args} /> : <OpponentPill args={args} />
      }
      suppressResultOverlay
      holdResultMs={HOLD_RESULT_MS}
      ownBarResult
      // #387: Coinflip's entire round IS the server's fixed 10s pick window (PICK_WINDOW_MS,
      // resolves ONLY at expiry) — the default ~2.4s "Searching…" dwell floor could burn enough of
      // it that the pick buttons never render before the window elapses. Zero hold here maximizes
      // the player's real share of that window; every other hub game keeps the default.
      searchFloorMs={0}
      {...props}
    />
  );
}
