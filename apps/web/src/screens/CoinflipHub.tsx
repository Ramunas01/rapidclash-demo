import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { CoinflipView } from '../App.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

/** Coin-face material gradients lifted from the export — gold (heads) / silver (tails). The resting
 *  and pick-phase coin is solid gold with a glow; it only flips to a face at the reveal. */
const COIN_GOLD = 'linear-gradient(135deg, #c89b3c 0%, #f0c85a 50%, #a07020 100%)';
const COIN_SILVER = 'linear-gradient(135deg, #9aa0ad 0%, #c8ced8 50%, #7a8090 100%)';
const COIN_GLOW = '0 0 55px 8px rgba(240,200,90,0.32)';

// Cosmetic pick countdown (seconds). Mirrors the coinflip module's `moveTimeoutMs` (10s) — the
// SERVER runs the authoritative clock + seeded auto-pick; this is display-only (the Keno/Limbo
// pattern). Kept local so the web app stays decoupled from the game packages.
const PICK_SECONDS = 10;
/** Hold the board mounted after match.end so the reveal stages: terminal frame (flip + opponent
 *  reveal) plays during the hold, then `outcome` arrives at the result phase and lights the outline. */
const HOLD_RESULT_MS = 1500;

const SIDES = [
  { id: 'heads', label: 'Heads', face: COIN_GOLD },
  { id: 'tails', label: 'Tails', face: COIN_SILVER },
] as const;

/** The server's terminal frame carries the flip `result` (stripped pre-terminal by viewFor). */
function isTerminal(view: CoinflipView | null): boolean {
  return Boolean(view?.result);
}

/**
 * The coin — solid gold with a soft glow while resting / during the pick window; at the reveal it
 * flips (one-shot spin, re-keyed by the result) and settles on the real face (gold heads / silver
 * tails). It never shows a face pre-terminal — the flip only exists in the match.end payload.
 */
function Coin({ face }: { face?: 'heads' | 'tails' | null }) {
  const flipping = face != null;
  const surface = face === 'tails' ? COIN_SILVER : COIN_GOLD; // resting + heads = gold
  return (
    <div className="relative h-32 w-32" style={{ perspective: '900px' }}>
      <motion.div
        key={flipping ? `flip-${face}` : 'rest'}
        aria-hidden
        initial={flipping ? { rotateY: 0 } : false}
        animate={flipping ? { rotateY: 1440 } : { rotateY: 0 }}
        transition={flipping ? { duration: 1.1, ease: [0.2, 0.8, 0.25, 1] } : { duration: 0.3 }}
        className="flex h-32 w-32 items-center justify-center rounded-full"
        style={{ background: surface, boxShadow: COIN_GLOW }}
      >
        <div className="flex h-[78%] w-[78%] items-center justify-center rounded-full border-[3px] border-white/20">
          {face && (
            <span data-testid="coin-face" className="text-sm font-extrabold uppercase tracking-wider text-white/85">{face}</span>
          )}
        </div>
      </motion.div>
    </div>
  );
}

/** Circular pick-deadline countdown (cosmetic — the server runs the authoritative `moveTimeoutMs`
 *  clock + seeded auto-pick). Sits to the left of the coin during the pick window. */
function CountdownRing({ seconds }: { seconds: number }) {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, seconds / PICK_SECONDS));
  return (
    <svg width={52} height={52} viewBox="0 0 48 48" data-testid="coin-countdown" role="timer" aria-label={`${seconds} seconds to pick`}>
      <circle cx={24} cy={24} r={r} fill="none" className="text-border" stroke="currentColor" strokeWidth={3} />
      <circle
        cx={24} cy={24} r={r} fill="none" className="text-brand" stroke="currentColor" strokeWidth={3}
        strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - frac)} transform="rotate(-90 24 24)"
      />
      <text x={24} y={29} textAnchor="middle" className="fill-foreground text-[15px] font-black tabular-nums">{seconds}</text>
    </svg>
  );
}

/** Greyed hero shown in Idle/Waiting — the gold coin, a soft glow, one line. Nothing else. */
function CoinflipIdle({ phase }: { phase: GameAreaArgs['phase'] }) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 py-3" data-testid="hub-board">
      <Coin />
      <p className="text-xs font-semibold text-muted-foreground">
        {phase === 'waiting' ? 'Finding a rival…' : 'Place your bet and play.'}
      </p>
    </div>
  );
}

/**
 * The live coin area. Pick window: the gold coin + the circular countdown (H/T selection lives in
 * the player's own slot pill — see renderSlotAside). At terminal the coin flips to the revealed
 * face. The opponent's pick and the flip never exist on the client before match.end (redaction is
 * server-side); the client only choreographs the reveal beats. Scroll-safety: when the round
 * resolves the board scrolls itself into view (replacing the old self-dismissing overlay's reach).
 */
function CoinflipBoard({ gameState, serverClockOffset = 0 }: GameAreaArgs) {
  const view = gameState as CoinflipView | null;
  const terminal = isTerminal(view);
  const result = (view?.result as 'heads' | 'tails' | undefined) ?? null;

  // Cosmetic countdown, driven by the server's authoritative window close (`windowEndsAt`) when
  // present — so it is accurate and RESTARTS automatically on each tie-replay round (windowEndsAt is
  // re-stamped). Falls back to a plain local count if the field is absent. Stops at the lock.
  const windowEndsAt = view?.windowEndsAt;
  const [seconds, setSeconds] = useState(PICK_SECONDS);
  useEffect(() => {
    if (terminal) return;
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
  }, [terminal, windowEndsAt, serverClockOffset]);

  // Scroll-safety: a match can resolve while the player is scrolled down at Open Games. Bring the
  // board into view on resolution so the reveal/outline reaches them (no-op if already in view).
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (terminal) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [terminal]);

  return (
    <div ref={ref} className="relative flex min-h-[200px] items-center justify-center py-3" data-testid="hub-board">
      {!terminal && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2">
          <CountdownRing seconds={seconds} />
        </div>
      )}
      <Coin face={terminal ? result : null} />
    </div>
  );
}

/** The Coinflip game-area slot: gold-coin hero in idle/waiting, the live coin board in-match and at
 *  the held result frame (so the flip animates before the board returns to PLAY). */
function CoinflipPanel(args: GameAreaArgs) {
  const live = args.phase === 'in-match' || args.phase === 'result';
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      {live ? <CoinflipBoard {...args} /> : <CoinflipIdle phase={args.phase} />}
    </div>
  );
}

/** A filled side capsule: gold HEADS / grey TAILS. Always shows the face colour. Tappable in the
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
        selected && 'ring-2 ring-brand ring-offset-2 ring-offset-surface',
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
  const myChoice = playerId ? (view?.choices?.[playerId] as 'heads' | 'tails' | undefined) : undefined;

  const [optimisticPick, setOptimisticPick] = useState<'heads' | 'tails' | null>(null);
  // A resolved round (a decisive result OR a draw before its auto-replay) closes the pick window;
  // clear the optimistic pick so the next window opens blank. The terminal frame reads the
  // server-recorded choice, so the outline never flickers during the reveal.
  useEffect(() => {
    if (terminal) setOptimisticPick(null);
  }, [terminal]);

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
        <SidePill key={s.id} side={s} selected={selected === s.id} onClick={() => handlePick(s.id)} />
      ))}
    </span>
  );
}

/** The opponent slot aside: shows "PLAYING…" during the blind pick window (correction 1 — the
 *  renderSlotAside callback always returns a React element so the GameHub fallback never fires;
 *  we render the tag explicitly). At terminal, the opponent's pick is staged from match.end. */
function OpponentPill({ args }: { args: GameAreaArgs }) {
  const { gameState, opponentId, phase } = args;
  const view = gameState as CoinflipView | null;
  if (!isTerminal(view)) {
    if (phase !== 'in-match') return null;
    return <span className="shrink-0 text-xs font-black uppercase tracking-wide text-foreground/70">PLAYING…</span>;
  }
  if (!opponentId) return null;
  const oppChoice = view?.choices?.[opponentId] as 'heads' | 'tails' | undefined;
  const side = SIDES.find((s) => s.id === oppChoice);
  if (!side) return null;
  return <SidePill side={side} testid="coin-opp-pick" />;
}

/**
 * Coinflip Hub = the shared GameHub + the gold-coin arena. Pick window: a circular countdown + H/T
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
      renderSlotAside={(args, side) => (side === 'own' ? <OwnPills args={args} /> : <OpponentPill args={args} />)}
      suppressResultOverlay
      holdResultMs={HOLD_RESULT_MS}
      ownBarResult
      {...props}
    />
  );
}
