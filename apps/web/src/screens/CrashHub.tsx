import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Outcome } from '@rapidclash/shared';
import type { CrashView, CrashResultView, GameView } from '../App.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';
import { DuelReveal } from './hub-shared/DuelReveal.js';
import rocketUrl from '../assets/crash/rocket.webp';
import moonUrl from '../assets/crash/moon.webp';

/** Display-only mirror of the server's altitude curve (packages/games/crash `CRASH_CONFIG`). The
 *  client animates the SAME shared climb from the server's `startedAt`, aligned to the server's
 *  clock (`serverClockOffset`), so what the player watches equals what the server banks on eject.
 *  Exported for the client↔server agreement test. */
const SCALE = 0.8;
const GROWTH = 0.45;
/** altitude(s) = scale·(e^(growth·s) − 1), metres. ONE altitude source — both the 60fps curve and
 *  the throttled readout sample this exact function of `Date.now() + serverClockOffset` (refinement
 *  #2), so "rendered == banked" holds by construction, not coincidence. */
export function altitudeAt(elapsedMs: number): number {
  const s = Math.max(0, elapsedMs) / 1000;
  return Math.floor(SCALE * (Math.exp(GROWTH * s) - 1));
}
/** Inverse of the curve: seconds-after-launch at which the climb first reaches `altitude`. Used
 *  ONLY to frame a frozen/terminal curve by its peak — never to drive the live animation. */
function timeToAltitudeSec(altitude: number): number {
  return Math.log(Math.max(0, altitude) / SCALE + 1) / GROWTH;
}

/** Throttle the floating readout to ~4 Hz so the number stays legible as it accelerates. */
const ALTITUDE_THROTTLE_MS = 250;
/** Keep the board mounted a beat after match.end so the explosion + red snap land before the
 *  reveal overlay (the Blackjack `holdResultMs` pattern). */
const HOLD_RESULT_MS = 1700;
/** Curve framing: min visible window so the early near-flat climb isn't degenerate, and headroom
 *  so the rocket tip never glues to an edge while the domains auto-rescale around it. */
const MIN_X_SEC = 3;
const MIN_Y_M = 50;
const X_HEADROOM = 1.08;
const Y_HEADROOM = 1.2;

/** A 60fps animation clock (rAF) while the round is live and we're still aboard. */
function useAnimationNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return now;
}

/** "Nice" round number ≥ v (1/2/2.5/5 × 10^k) — for an auto-rescaling axis ceiling. */
function niceCeil(v: number): number {
  if (v <= 0) return 0;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const f = v / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * base;
}
/** Clean monotonic ascending ticks 0…max with a nice step (no duplicates / out-of-order — the
 *  mock's drawn ladder is buggy; these are dynamic and auto-rescale with the domain). */
function niceTicks(max: number, count: number): number[] {
  if (max <= 0) return [0];
  const step = niceCeil(max / count);
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v));
  return out;
}

// SVG coordinate field geometry (viewBox units).
const VB = { w: 320, h: 232, padL: 36, padR: 16, padT: 16, padB: 26 };
const PLOT = {
  x0: VB.padL,
  x1: VB.w - VB.padR,
  y0: VB.padT, // top
  y1: VB.h - VB.padB, // bottom (origin line)
};

interface ChartProps {
  /** Seconds at the rocket tip (drives the X domain). 0 ⇒ rocket on the pad, no trail. */
  tipSec: number;
  /** Altitude at the tip (drives the Y domain + the floating readout origin). */
  tipAltitude: number;
  /** Terminal crash: snap the trail red and explode at the tip instead of riding the rocket. */
  crashed: boolean;
}

/** The Crash coordinate field — Crash-specific arena content (curve, axes, moon, explosion). The
 *  trail is the climb history: a gradient polyline sampled from the SAME `altitudeAt` the server
 *  banks on, with both axes auto-rescaling so the accelerating curve stays framed. */
function CrashChart({ tipSec, tipAltitude, crashed }: ChartProps) {
  const xMaxSec = Math.max(tipSec * X_HEADROOM, MIN_X_SEC);
  const yMax = Math.max(niceCeil(tipAltitude * Y_HEADROOM), MIN_Y_M);
  const sx = (s: number) => PLOT.x0 + (s / xMaxSec) * (PLOT.x1 - PLOT.x0);
  const sy = (a: number) => PLOT.y1 - (a / yMax) * (PLOT.y1 - PLOT.y0);

  // Sample the trail from launch to the tip along the real curve (history grows from the origin).
  const STEPS = 72;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= STEPS; i++) {
    const s = (i / STEPS) * tipSec;
    pts.push([sx(s), sy(altitudeAt(s * 1000))]);
  }
  const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [tipX, tipY] = pts[pts.length - 1] ?? [PLOT.x0, PLOT.y1];

  const yTicks = niceTicks(yMax, 4);
  const xTicks = niceTicks(xMaxSec, 4);

  return (
    <svg
      data-testid="crash-chart"
      viewBox={`0 0 ${VB.w} ${VB.h}`}
      className="h-full w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Altitude ${tipAltitude} metres`}
    >
      <defs>
        {/* orange → pink → purple along the climb (mock gradient) */}
        <linearGradient id="crash-trail" gradientUnits="userSpaceOnUse" x1={PLOT.x0} y1={PLOT.y1} x2={tipX} y2={tipY}>
          <stop offset="0%" stopColor="#fb923c" />
          <stop offset="55%" stopColor="#ec4899" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>

      {/* Y axis + altitude ticks (auto-rescaling) */}
      <line x1={PLOT.x0} y1={PLOT.y0} x2={PLOT.x0} y2={PLOT.y1} stroke="currentColor" className="text-border" strokeWidth={1} />
      <g data-testid="crash-axis-y" className="text-muted-foreground" fontSize={9} fill="currentColor">
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PLOT.x0 - 3} y1={sy(t)} x2={PLOT.x1} y2={sy(t)} stroke="currentColor" className="text-border/40" strokeWidth={0.5} />
            <text x={PLOT.x0 - 5} y={sy(t) + 3} textAnchor="end">{t}{t > 0 ? 'm' : ''}</text>
          </g>
        ))}
      </g>

      {/* X axis + time ticks (auto-rescaling/compressing) */}
      <line x1={PLOT.x0} y1={PLOT.y1} x2={PLOT.x1} y2={PLOT.y1} stroke="currentColor" className="text-border" strokeWidth={1} />
      <g data-testid="crash-axis-x" className="text-muted-foreground" fontSize={9} fill="currentColor">
        {xTicks.filter((t) => t > 0).map((t) => (
          <text key={t} x={sx(t)} y={PLOT.y1 + 12} textAnchor="middle">{t < 10 ? t.toFixed(1) : t}s</text>
        ))}
      </g>
      <text x={PLOT.x0 - 5} y={PLOT.y1 + 12} textAnchor="end" fontSize={9} className="text-muted-foreground" fill="currentColor">O</text>

      {/* The climb trail */}
      {tipSec > 0 && (
        <path
          data-testid="crash-curve"
          d={path}
          fill="none"
          stroke={crashed ? '#ef4444' : 'url(#crash-trail)'}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* Rocket riding the tip — or the explosion at the crash point */}
      {crashed ? (
        <text data-testid="crash-explosion" x={tipX} y={tipY + 9} textAnchor="middle" fontSize={26}>💥</text>
      ) : (
        <image
          data-testid="crash-rocket"
          href={rocketUrl}
          width={34}
          height={34}
          x={tipX - 14}
          y={tipY - 22}
          transform={`rotate(8 ${tipX} ${tipY})`}
        />
      )}
    </svg>
  );
}

/** Pre-game / waiting board — no rocket yet; it launches on match.start. */
function CrashIdle({ phase }: { phase: GameAreaArgs['phase'] }) {
  return (
    <div data-testid="hub-board" className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-2xl bg-surface p-6 text-center">
      <span className="text-5xl" aria-hidden="true">🚀</span>
      <p className="text-sm font-semibold text-muted-foreground">
        {phase === 'waiting' ? 'Finding a rival…' : 'Place your bet and launch'}
      </p>
    </div>
  );
}

/** The single primary arena action — template-shaped (PLAY lives on the GameHub; this is the
 *  in-arena state: GET READY → EJECT → locked-waiting). Flagged for reuse across duel hubs. */
function ActionButton({
  label,
  disabled,
  onClick,
  tone = 'brand',
  testid,
}: {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  tone?: 'brand' | 'muted';
  testid: string;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'w-full max-w-xs rounded-xl py-4 text-lg font-black uppercase tracking-wider text-white transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-brand',
        tone === 'brand' ? 'bg-brand hover:opacity-90' : 'bg-surface text-muted-foreground',
        'disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      {label}
    </button>
  );
}

/** Floating altitude pill, fixed over the chart (mock's "900m") — reads the throttled, server-
 *  aligned altitude (the same `altitudeAt` as the rocket tip, sampled at ~4 Hz). */
function AltitudePill({ metres, crashed }: { metres: number; crashed: boolean }) {
  return (
    <div className="pointer-events-none absolute left-1/4 top-5">
      <span
        data-testid="crash-altitude"
        className={cn(
          'rounded-lg px-3 py-1 text-4xl font-black tabular-nums shadow-lg',
          crashed ? 'bg-destructive/20 text-destructive' : 'bg-brand/25 text-foreground',
        )}
      >
        {metres}
        <span className="text-xl font-bold text-muted-foreground"> m</span>
      </span>
    </div>
  );
}

/**
 * Live Crash arena across the phases — SETUP countdown (rocket on the pad) → IGNITION → the CLIMB
 * (the gradient curve rising in real time, EJECT before it crashes) → the terminal crash (red snap
 * + explosion at C). Phase + altitude derive from the server's public `setupEndsAt`/`startedAt`,
 * the local clock aligned via `serverClockOffset`. The opponent's nerve and the crash altitude
 * stay hidden until terminal — a blind duel; the chart only ever renders this player's own state.
 */
function CrashBoard({ gameState, legalMoves, onMove, playerId, serverClockOffset = 0 }: GameAreaArgs) {
  const view = gameState as CrashView | null;
  const startedAt = view?.startedAt ?? 0;
  const setupEndsAt = view?.setupEndsAt ?? 0;
  const isTerminal = Boolean(view?.terminal);
  const myResult = (playerId && view?.results?.[playerId]) || undefined;
  const done = Boolean(myResult);

  // ONE clock: Date.now() aligned to the server, ticked at 60fps while the climb is live.
  const animate = Boolean(startedAt) && !done && !isTerminal;
  const now = useAnimationNow(animate) + serverClockOffset;
  const elapsed = now - startedAt;
  const inSetup = !done && !isTerminal && startedAt > 0 && now < setupEndsAt;
  const inIgnition = !done && !isTerminal && startedAt > 0 && now >= setupEndsAt && now < startedAt;
  const inClimb = !done && !isTerminal && startedAt > 0 && now >= startedAt;

  // Floating readout: the SAME altitudeAt, sampled at ~4 Hz (a coarser sample of the tip).
  const throttledElapsed = Math.floor(Math.max(0, elapsed) / ALTITUDE_THROTTLE_MS) * ALTITUDE_THROTTLE_MS;
  const liveAltitude = altitudeAt(throttledElapsed);

  // ── Frame the chart per phase ───────────────────────────────────────────────────────────
  let chart: ChartProps;
  let crashedView = false;
  if (isTerminal) {
    // Reveal frame: explode at C if anyone rode to the crash; else frame the highest eject.
    const banks = view ? Object.values(view.results).filter(Boolean) as CrashResultView[] : [];
    const anyCrashed = banks.some((r) => r.crashed);
    const survivedPeak = banks.reduce((m, r) => (r.crashed ? m : Math.max(m, r.altitude)), 0);
    const peak = anyCrashed ? (view?.crashAltitude ?? survivedPeak) : survivedPeak;
    crashedView = anyCrashed;
    chart = { tipSec: timeToAltitudeSec(peak), tipAltitude: peak, crashed: anyCrashed };
  } else if (done) {
    // I've ejected — freeze the rocket at my banked altitude while the round resolves.
    const a = myResult!.crashed ? 0 : myResult!.altitude;
    chart = { tipSec: timeToAltitudeSec(a), tipAltitude: a, crashed: myResult!.crashed };
  } else if (inClimb) {
    chart = { tipSec: Math.max(0, elapsed) / 1000, tipAltitude: liveAltitude, crashed: false };
  } else {
    chart = { tipSec: 0, tipAltitude: 0, crashed: false }; // on the pad (setup / ignition)
  }

  // ── Button state machine (item 5) ───────────────────────────────────────────────────────
  const canEject = inClimb && legalMoves.length > 0;
  let button;
  if (inSetup || inIgnition) {
    button = <ActionButton testid="crash-getready" label="Get ready…" disabled tone="muted" />;
  } else if (inClimb) {
    button = <ActionButton testid="crash-eject" label="Eject" disabled={!canEject} onClick={() => onMove('eject')} />;
  } else if (done && !isTerminal) {
    const lockedLabel = myResult!.crashed ? 'Busted · waiting…' : `Locked at ${myResult!.altitude} m · waiting…`;
    button = <ActionButton testid="crash-own-result" label={lockedLabel} disabled tone="muted" />;
  } else {
    button = null; // terminal → the reveal overlay takes over after the hold beat
  }

  const showAltitude = inClimb || (done && !isTerminal) || isTerminal;
  const countdownSec = inSetup ? Math.max(1, Math.ceil((setupEndsAt - now) / 1000)) : 0;

  return (
    <div className="flex flex-col items-center gap-4">
      <div data-testid="hub-board" className="relative aspect-[320/232] w-full overflow-hidden rounded-2xl bg-surface">
        <img src={moonUrl} alt="" aria-hidden="true" className="pointer-events-none absolute right-3 top-3 h-14 w-14 opacity-90" />
        <CrashChart {...chart} />
        {showAltitude && <AltitudePill metres={chart.tipAltitude} crashed={crashedView || (done && myResult!.crashed)} />}
        {inSetup && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <p data-testid="crash-countdown" className="text-3xl font-black tabular-nums text-foreground drop-shadow">Launching in {countdownSec}…</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Get ready to eject</p>
          </div>
        )}
        {inIgnition && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p data-testid="crash-ignition" className="text-2xl font-black uppercase tracking-wider text-foreground drop-shadow">Ignition…</p>
          </div>
        )}
        {isTerminal && crashedView && view?.crashAltitude != null && (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center">
            <p className="text-xs font-bold uppercase tracking-wide text-destructive drop-shadow">💥 Rocket exploded at {view.crashAltitude} m</p>
          </div>
        )}
      </div>
      {button}
    </div>
  );
}

function CrashPanel(args: GameAreaArgs) {
  return args.phase === 'in-match' ? <CrashBoard {...args} /> : <CrashIdle phase={args.phase} />;
}

/** Result reveal (item 6): the crash point C + both locked banks, side by side. Crash adapts the
 *  shared `DuelReveal` template — the "m" unit, the 0 m-bust and the crash caption are Crash-side;
 *  the verdict + ¢ delta come from the GameHub overlay that wraps this. */
function CrashReveal({ gameState, playerId }: { outcome: Outcome; gameState: GameView | null; playerId: string | null }) {
  const view = gameState as CrashView | null;
  if (!view || !playerId) return null;
  const opp = view.players.find((p) => p !== playerId);
  const mine = view.results[playerId];
  const theirs = opp ? view.results[opp] : undefined;
  const anyCrashed = [mine, theirs].some((r) => r?.crashed);
  const fmt = (r?: CrashResultView) => (r ? (r.crashed ? '0 m' : `${r.altitude} m`) : '—');
  return (
    <div className="mb-3" data-testid="hub-result-crash">
      {view.crashAltitude != null && (
        <p className={cn('mb-2 text-center text-xs font-semibold uppercase tracking-wide', anyCrashed ? 'text-destructive' : 'text-muted-foreground')}>
          {anyCrashed ? `Rocket crashed at ${view.crashAltitude} m` : `Crash point was ${view.crashAltitude} m`}
        </p>
      )}
      <DuelReveal
        players={[
          { label: 'You', value: fmt(mine), busted: mine?.crashed },
          { label: 'Opponent', value: fmt(theirs), busted: theirs?.crashed },
        ]}
      />
    </div>
  );
}

/**
 * Crash Hub = the shared GameHub + the Crash arena: a coordinate field with the live rising curve
 * (the demo's centrepiece), a floating altitude readout, auto-rescaling axes, the moon, the EJECT
 * state machine, the terminal explosion, and the side-by-side reveal. Live-EJECT only for humans
 * (the module keeps server-side auto-eject for bots). The shared seeded crash, the eject/bust
 * logic, redaction and settlement are all server-authoritative — this is the presentation client.
 */
export function CrashHubScreen(props: GameHubScreenProps) {
  return (
    <GameHub
      gameId="crash"
      gameName="Crash"
      renderGameArea={CrashPanel}
      renderResultReveal={CrashReveal}
      holdResultMs={HOLD_RESULT_MS}
      {...props}
    />
  );
}
