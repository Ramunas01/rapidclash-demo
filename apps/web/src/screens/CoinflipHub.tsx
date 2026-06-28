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
/** Beat before the own-pill result outline lights (after the flip lands). */
const OUTLINE_DELAY_MS = 250;

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
function CoinflipBoard({ gameState }: GameAreaArgs) {
  const view = gameState as CoinflipView | null;
  const terminal = isTerminal(view);
  const result = (view?.result as 'heads' | 'tails' | undefined) ?? null;

  // Cosmetic countdown (server clock authoritative). Starts on match mount, stops at lock.
  const [seconds, setSeconds] = useState(PICK_SECONDS);
  useEffect(() => {
    if (terminal) return;
    const id = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [terminal]);

  // Scroll-safety: a match can resolve while the player is scrolled down at Open Games. Bring the
  // board into view on resolution so the reveal/outline reaches them (no-op if already in view).
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (terminal) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [terminal]);

  return (
    <div ref={ref} className="flex min-h-[200px] items-center justify-center gap-5 py-3" data-testid="hub-board">
      {!terminal && <CountdownRing seconds={seconds} />}
      <Coin face={terminal ? result : null} />
    </div>
  );
}

/** The Coinflip game-area slot: gold-coin hero in idle/waiting, the live coin board in-match and at
 *  the held result frame (so the flip animates before the board returns to PLAY). */
function CoinflipPanel(args: GameAreaArgs) {
  const live = args.phase === 'in-match' || args.phase === 'result';
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      {live ? <CoinflipBoard {...args} /> : <CoinflipIdle phase={args.phase} />}
    </div>
  );
}

/** A small side pill: gold HEADS / silver TAILS. Tappable in the pick window, static (locked) at
 *  reveal, where `outline` rings it green (won) / red (lost) / orange (draw) — the Blackjack
 *  card-outline convention, applied to the slot pill. */
function SidePill({
  side,
  picked,
  disabled,
  outline,
  onClick,
  testid,
}: {
  side: (typeof SIDES)[number];
  picked: boolean;
  disabled?: boolean;
  outline?: 'win' | 'lose' | 'draw' | null;
  onClick?: () => void;
  testid?: string;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick, disabled } : {})}
      data-testid={testid ?? `hub-move-${side.id}`}
      aria-label={side.label}
      className={cn(
        'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-extrabold uppercase tracking-wide transition-all',
        picked ? 'text-white' : 'text-muted-foreground',
        onClick && 'disabled:cursor-not-allowed disabled:opacity-50',
        outline === 'win' && 'ring-[3px] ring-success shadow-[0_0_12px_rgba(34,197,94,0.5)]',
        outline === 'lose' && 'ring-[3px] ring-destructive shadow-[0_0_12px_rgba(239,68,68,0.45)]',
        outline === 'draw' && 'ring-[3px] ring-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.45)]',
      )}
      style={{ background: picked ? side.face : 'hsl(var(--surface))' }}
    >
      <span className="h-3.5 w-3.5 rounded-full" style={{ background: side.face }} aria-hidden="true" />
      {side.label}
    </Tag>
  );
}

/** Delay a flag by `ms` after it goes true (Blackjack's outline-reveal timing). */
function useDelayedFlag(active: boolean, ms: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active) {
      setOn(false);
      return;
    }
    const id = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(id);
  }, [active, ms]);
  return on;
}

/** The own slot aside: H/T pills to pick during the window; at reveal, the locked pick rings with
 *  the win/lose/draw outline. Reuses the renderSlotAside('own') path Blackjack uses for Hit/Stand. */
function OwnPills({ args }: { args: GameAreaArgs }) {
  const { gameState, legalMoves, onMove, playerId, phase, outcome } = args;
  const view = gameState as CoinflipView | null;
  const terminal = isTerminal(view);
  const myChoice = playerId ? (view?.choices?.[playerId] as 'heads' | 'tails' | undefined) : undefined;
  const canMove = legalMoves.length > 0;

  // Result outline (server outcome only), lit a beat after the flip lands.
  const frameKind =
    outcome == null ? null : outcome.type === 'draw' ? 'draw' : outcome.type === 'void' ? null : outcome.winner === playerId ? 'win' : 'lose';
  const lit = useDelayedFlag(phase === 'result' && frameKind != null, OUTLINE_DELAY_MS);
  const outline = lit ? frameKind : null;

  if (terminal) {
    // Locked (held result frame): show only the chosen side, ringed by the result outline.
    const side = SIDES.find((s) => s.id === myChoice);
    if (!side) return null;
    return <SidePill side={side} picked outline={outline} testid="coin-own-pick" />;
  }

  // The H/T selector lives in the pill ONLY during the live pick window — never on the idle tile.
  if (phase !== 'in-match') return null;

  return (
    <span className="flex items-center gap-1.5" role="group" aria-label="Pick a side">
      {SIDES.map((s) => (
        <SidePill key={s.id} side={s} picked={myChoice === s.id} disabled={!canMove} onClick={() => onMove(s.id)} />
      ))}
    </span>
  );
}

/** The opponent slot aside: nothing during the blind pick window (the slot keeps its "Playing…"
 *  tag); at reveal, the opponent's pick appears on their row (staged from match.end). */
function OpponentPill({ args }: { args: GameAreaArgs }) {
  const { gameState, opponentId } = args;
  const view = gameState as CoinflipView | null;
  if (!isTerminal(view) || !opponentId) return null;
  const oppChoice = view?.choices?.[opponentId] as 'heads' | 'tails' | undefined;
  const side = SIDES.find((s) => s.id === oppChoice);
  if (!side) return null;
  return <SidePill side={side} picked testid="coin-opp-pick" />;
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
      {...props}
    />
  );
}
