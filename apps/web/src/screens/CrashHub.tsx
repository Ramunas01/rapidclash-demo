import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { CrashView } from '../App.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';
import { SlotPill, useDelayedFlag, outlineForOutcome, SLOT_OUTLINE_BEAT_MS } from './hub-shared/slotReveal.js';
import rocketUrl from '../assets/crash/rocket.webp';
import moonUrl from '../assets/crash/moon.webp';

/** Display-only mirror of the server's altitude curve (packages/games/crash `CRASH_CONFIG`). ONE
 *  altitude source: both the curve geometry and the floating readout sample this exact analytic
 *  function of `Date.now() + serverClockOffset`, so what the player watches equals what the server
 *  banks on eject. `altitudeRaw` is the continuous curve (smooth render); `altitudeAt` is the
 *  floored metres the server banks (the readout). Exported for the client↔server agreement test. */
const SCALE = 0.8;
const GROWTH = 0.45;
function altitudeRaw(elapsedMs: number): number {
  const s = Math.max(0, elapsedMs) / 1000;
  return SCALE * (Math.exp(GROWTH * s) - 1);
}
export function altitudeAt(elapsedMs: number): number {
  return Math.floor(altitudeRaw(elapsedMs));
}
/** Inverse of the curve: seconds-after-launch at which the climb reaches `altitude`. Frames a
 *  frozen/terminal curve by its peak — never drives the live animation. */
function timeToAltitudeSec(altitude: number): number {
  return Math.log(Math.max(0, altitude) / SCALE + 1) / GROWTH;
}

/** Throttle the floating readout to ~4 Hz so the number stays legible as it accelerates. */
const ALTITUDE_THROTTLE_MS = 250;
/** Follow-camera: once the tip reaches these screen fractions it HOLDS there and the axes rescale
 *  around it (Y compresses, X extends) — the world moves, not the rocket. Continuous (no nice-
 *  stepping the domain) so the tip never jumps → no bounce. */
const TARGET_Y_FRAC = 0.68;
const TARGET_X_FRAC = 0.82;
/** Small initial window so the early near-flat climb is visible before the camera starts to follow. */
const INITIAL_Y_M = 60;
const INITIAL_X_SEC = 4;

/** A 60fps animation clock (rAF) while the climb is live. */
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

/** A coarse interval clock for the button (setup→climb flip; the altitude never reads from here). */
function useIntervalNow(active: boolean, ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

/** "Nice" round number ≥ v (1/2/2.5/5 × 10^k) — for axis tick LABELS (the domain stays continuous). */
function niceCeil(v: number): number {
  if (v <= 0) return 0;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const f = v / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * base;
}
/** Clean monotonic ascending ticks 0…max with a nice step (no duplicates / out-of-order). */
function niceTicks(max: number, count: number): number[] {
  if (max <= 0) return [0];
  const step = niceCeil(max / count);
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v));
  return out;
}

// SVG coordinate field geometry (viewBox units).
const VB = { w: 320, h: 232, padL: 38, padR: 16, padT: 16, padB: 26 };
const PLOT = { x0: VB.padL, x1: VB.w - VB.padR, y0: VB.padT, y1: VB.h - VB.padB };

interface ChartProps {
  /** Seconds at the tip (drives the X domain). 0 ⇒ parked at the origin, no trail. */
  tipSec: number;
  /** Continuous altitude at the tip (drives the Y domain + tip position). */
  tipAltitudeRaw: number;
  /** Terminal crash: snap the trail red and explode at the tip instead of riding the rocket. */
  crashed: boolean;
}

/** The Crash coordinate field — Crash-specific arena content (smooth analytic curve, follow-camera
 *  axes, moon, parked rocket / explosion). The trail is one continuous gradient curve from the SAME
 *  `altitudeRaw` the server banks on; the camera holds the tip at a fixed screen point and rescales
 *  the axes around it, so the curve stays framed and never bounces. */
function CrashChart({ tipSec, tipAltitudeRaw, crashed }: ChartProps) {
  // Continuous follow-camera domains — the tip sits at a fixed fraction once past the initial window.
  const yMax = Math.max(INITIAL_Y_M, tipAltitudeRaw / TARGET_Y_FRAC);
  const xMax = Math.max(INITIAL_X_SEC, tipSec / TARGET_X_FRAC);
  const sx = (s: number) => PLOT.x0 + (s / xMax) * (PLOT.x1 - PLOT.x0);
  const sy = (a: number) => PLOT.y1 - (a / yMax) * (PLOT.y1 - PLOT.y0);

  // One smooth curve sampled along the analytic altitude(t) — fine enough to read as continuous.
  const STEPS = 84;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= STEPS; i++) {
    const s = (i / STEPS) * tipSec;
    pts.push([sx(s), sy(altitudeRaw(s * 1000))]);
  }
  const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const parked = tipSec <= 0;
  const [tipX, tipY] = parked ? [PLOT.x0, PLOT.y1] : pts[pts.length - 1];

  const yTicks = niceTicks(yMax, 4);
  const xTicks = niceTicks(xMax, 4);

  return (
    <svg data-testid="crash-chart" viewBox={`0 0 ${VB.w} ${VB.h}`} className="h-full w-full" preserveAspectRatio="none" role="img" aria-label={`Altitude ${Math.floor(tipAltitudeRaw)} metres`}>
      <defs>
        <linearGradient id="crash-trail" gradientUnits="userSpaceOnUse" x1={PLOT.x0} y1={PLOT.y1} x2={tipX} y2={tipY}>
          <stop offset="0%" stopColor="#fb923c" />
          <stop offset="55%" stopColor="#ec4899" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>

      {/* Y axis + altitude ticks (auto-compressing) */}
      <line x1={PLOT.x0} y1={PLOT.y0} x2={PLOT.x0} y2={PLOT.y1} stroke="currentColor" className="text-border" strokeWidth={1} />
      <g data-testid="crash-axis-y" className="text-muted-foreground" fontSize={9} fill="currentColor">
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PLOT.x0 - 3} y1={sy(t)} x2={PLOT.x1} y2={sy(t)} stroke="currentColor" className="text-border/40" strokeWidth={0.5} />
            <text x={PLOT.x0 - 5} y={sy(t) + 3} textAnchor="end">{t}{t > 0 ? 'm' : ''}</text>
          </g>
        ))}
      </g>

      {/* X axis + time ticks (auto-extending) */}
      <line x1={PLOT.x0} y1={PLOT.y1} x2={PLOT.x1} y2={PLOT.y1} stroke="currentColor" className="text-border" strokeWidth={1} />
      <g data-testid="crash-axis-x" className="text-muted-foreground" fontSize={9} fill="currentColor">
        {xTicks.filter((t) => t > 0).map((t) => (
          <text key={t} x={sx(t)} y={PLOT.y1 + 12} textAnchor="middle">{t < 10 ? t.toFixed(1) : t}s</text>
        ))}
      </g>
      <text x={PLOT.x0 - 5} y={PLOT.y1 + 12} textAnchor="end" fontSize={9} className="text-muted-foreground" fill="currentColor">O</text>

      {/* The climb trail — one continuous curve */}
      {!parked && (
        <path data-testid="crash-curve" d={path} fill="none" stroke={crashed ? '#ef4444' : 'url(#crash-trail)'} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      )}

      {/* Rocket riding the tip / parked at the origin — or the explosion at the crash point */}
      {crashed ? (
        <text data-testid="crash-explosion" x={tipX} y={tipY + 9} textAnchor="middle" fontSize={26}>💥</text>
      ) : (
        <image data-testid="crash-rocket" href={rocketUrl} width={34} height={34} x={Math.max(tipX - 14, PLOT.x0 - 8)} y={tipY - 24} transform={`rotate(-10 ${tipX} ${tipY})`} />
      )}
    </svg>
  );
}

/** Floating altitude pill, fixed over the chart — the throttled, server-aligned floored metres
 *  (the SAME `altitudeAt` the server banks). */
function AltitudePill({ metres, crashed }: { metres: number; crashed: boolean }) {
  return (
    <div className="pointer-events-none absolute left-1/4 top-5">
      <span data-testid="crash-altitude" className={cn('rounded-lg px-3 py-1 text-4xl font-black tabular-nums shadow-lg', crashed ? 'bg-destructive/20 text-destructive' : 'bg-brand/25 text-foreground')}>
        {metres}
        <span className="text-xl font-bold text-muted-foreground"> m</span>
      </span>
    </div>
  );
}

/**
 * The Crash arena board across every phase — the live coordinate field. Preview (idle/waiting):
 * the real chart frozen at 0 m with the rocket parked at the origin + helper text (the Coinflip-
 * style "live game at rest"). SETUP: parked + countdown. CLIMB: the smooth follow-camera curve +
 * floating readout. Terminal: the red snap + explosion at C. The opponent's nerve and the crash
 * altitude stay hidden until terminal — the board only ever renders this player's own state.
 */
function CrashBoard({ phase, gameState, playerId, serverClockOffset = 0 }: GameAreaArgs) {
  const view = gameState as CrashView | null;
  const startedAt = view?.startedAt ?? 0;
  const setupEndsAt = view?.setupEndsAt ?? 0;
  const isTerminal = Boolean(view?.terminal);
  const myResult = (playerId && view?.results?.[playerId]) || undefined;
  const done = Boolean(myResult);
  const live = phase === 'in-match' || phase === 'result';

  // ONE clock: Date.now() aligned to the server, ticked at 60fps while the climb is live.
  const animate = live && Boolean(startedAt) && !done && !isTerminal;
  const now = useAnimationNow(animate) + serverClockOffset;
  const elapsed = now - startedAt;
  const inSetup = live && !done && !isTerminal && startedAt > 0 && now < setupEndsAt;
  const inIgnition = live && !done && !isTerminal && startedAt > 0 && now >= setupEndsAt && now < startedAt;
  const inClimb = live && !done && !isTerminal && startedAt > 0 && now >= startedAt;

  // Floating readout: the SAME altitude function, sampled at ~4 Hz (a coarser sample of the tip).
  const throttledElapsed = Math.floor(Math.max(0, elapsed) / ALTITUDE_THROTTLE_MS) * ALTITUDE_THROTTLE_MS;
  const liveAltitude = altitudeAt(throttledElapsed);

  // ── Frame the chart per phase ───────────────────────────────────────────────────────────
  let chart: ChartProps;
  let crashedView = false;
  if (isTerminal && view) {
    const banks = Object.values(view.results).filter(Boolean) as Array<{ altitude: number; crashed: boolean }>;
    const anyCrashed = banks.some((r) => r.crashed);
    const survivedPeak = banks.reduce((m, r) => (r.crashed ? m : Math.max(m, r.altitude)), 0);
    const peak = anyCrashed ? (view.crashAltitude ?? survivedPeak) : survivedPeak;
    crashedView = anyCrashed;
    chart = { tipSec: timeToAltitudeSec(peak), tipAltitudeRaw: peak, crashed: anyCrashed };
  } else if (done && myResult) {
    const a = myResult.crashed ? 0 : myResult.altitude;
    chart = { tipSec: timeToAltitudeSec(a), tipAltitudeRaw: a, crashed: myResult.crashed };
  } else if (inClimb) {
    chart = { tipSec: Math.max(0, elapsed) / 1000, tipAltitudeRaw: altitudeRaw(throttledElapsed), crashed: false };
  } else {
    chart = { tipSec: 0, tipAltitudeRaw: 0, crashed: false }; // parked (preview / setup / ignition)
  }

  const showAltitude = inClimb || (done && !isTerminal) || isTerminal;
  const altMetres = isTerminal ? Math.floor(chart.tipAltitudeRaw) : done && myResult ? (myResult.crashed ? 0 : myResult.altitude) : liveAltitude;
  const countdownSec = inSetup ? Math.max(1, Math.ceil((setupEndsAt - now) / 1000)) : 0;

  return (
    <div data-testid="hub-board" className="relative aspect-[320/232] w-full overflow-hidden rounded-2xl bg-surface">
      <img src={moonUrl} alt="" aria-hidden="true" className="pointer-events-none absolute right-3 top-3 h-14 w-14 opacity-90" />
      <CrashChart {...chart} />
      {showAltitude && <AltitudePill metres={altMetres} crashed={crashedView || (done && !!myResult?.crashed)} />}

      {!live && (
        <div className="pointer-events-none absolute inset-x-0 bottom-7 text-center">
          <p className="text-sm font-semibold text-muted-foreground drop-shadow">{phase === 'waiting' ? 'Finding a rival…' : 'Place your bet and launch.'}</p>
        </div>
      )}
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
  );
}

function CrashPanel(args: GameAreaArgs) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <CrashBoard {...args} />
    </div>
  );
}

/** The single primary action, transformed in place in the PLAY button's slot (the #1 fix — never a
 *  second control): GET READY (on the pad) → EJECT (climbing) → WAITING (after you eject) → and,
 *  once the round resolves, null so the default PLAY returns. The locked altitude lives on the pill,
 *  not here. EJECT only sends the intent (`onMove('eject')`); the server banks `ctx.now`. */
function CrashPrimaryAction({ args }: { args: GameAreaArgs }) {
  // Rendered ONLY mid-flight (the wrapper returns null otherwise → the default PLAY button returns).
  const { gameState, legalMoves, onMove, playerId, serverClockOffset = 0 } = args;
  const view = gameState as CrashView | null;
  const startedAt = view?.startedAt ?? 0;
  const done = Boolean(playerId && view?.results?.[playerId]);
  const active = startedAt > 0 && !done;
  const now = useIntervalNow(active, 250) + serverClockOffset;
  const inClimb = active && now >= startedAt;
  const canEject = inClimb && legalMoves.includes('eject');

  const base = 'w-full rounded-xl py-4 text-base font-black uppercase tracking-wider text-white transition-colors disabled:cursor-not-allowed';
  if (done) {
    return <button type="button" data-testid="crash-waiting" disabled className={cn(base, 'bg-surface text-muted-foreground opacity-60')}>Waiting…</button>;
  }
  if (inClimb) {
    return (
      <button type="button" data-testid="crash-eject" disabled={!canEject} onClick={() => onMove('eject')} className={cn(base, 'bg-brand hover:brightness-110 disabled:opacity-40')}>
        Eject
      </button>
    );
  }
  return <button type="button" data-testid="crash-getready" disabled className={cn(base, 'bg-surface text-muted-foreground opacity-60')}>Get ready…</button>;
}

/** Own slot pill: blank until you act, then "Locked {A}m" / "Crashed" — the locked altitude lives
 *  here (off the button). At terminal a green/red/orange outline lights 0.5 s after the opponent's
 *  reveal (shared `useDelayedFlag` beat), driven strictly by the server outcome. */
function CrashOwnPill({ args }: { args: GameAreaArgs }) {
  const { gameState, playerId, phase, outcome } = args;
  const view = gameState as CrashView | null;
  const myResult = (playerId && view?.results?.[playerId]) || undefined;
  const verdict = outlineForOutcome(outcome, playerId);
  const lit = useDelayedFlag(phase === 'result' && verdict != null, SLOT_OUTLINE_BEAT_MS);
  if (!myResult) return null; // blank during flight, until I eject/crash
  return (
    <SlotPill testid="crash-own-pill" busted={myResult.crashed} outline={lit ? verdict : null}>
      {myResult.crashed ? 'Crashed' : `Locked ${myResult.altitude}m`}
    </SlotPill>
  );
}

/** Opponent slot pill: BLANK during flight (leak guard — never their eject pre-terminal); at
 *  terminal it reveals their "Locked {B}m" or "Crashed". */
function CrashOpponentPill({ args }: { args: GameAreaArgs }) {
  const { gameState, opponentId } = args;
  const view = gameState as CrashView | null;
  if (!view?.terminal || !opponentId) return null;
  const r = view.results?.[opponentId];
  if (!r) return null;
  return (
    <SlotPill testid="crash-opp-pill" busted={r.crashed}>
      {r.crashed ? 'Crashed' : `Locked ${r.altitude}m`}
    </SlotPill>
  );
}

/**
 * Crash Hub = the shared GameHub + the Crash arena: the smooth follow-camera curve (the demo
 * centrepiece + bounce fix), the floating readout, auto-compressing axes, the moon, the ONE
 * transforming PLAY→EJECT button, the terminal explosion, and the Stage-3 slot-pill reveal with the
 * shared green/red/orange outline + 0.5 s beat. The shared seeded crash, eject/bust logic, redaction
 * and settlement are all server-authoritative — this is the presentation client (no server change).
 */
export function CrashHubScreen(props: GameHubScreenProps) {
  return (
    <GameHub
      gameId="crash"
      gameName="Crash"
      renderGameArea={CrashPanel}
      renderPrimaryAction={(args) => {
        // Transform PLAY in place ONLY mid-flight; null (idle / resolved) → the default PLAY button.
        const v = args.gameState as CrashView | null;
        return args.phase === 'in-match' && !v?.terminal ? <CrashPrimaryAction args={args} /> : null;
      }}
      renderSlotAside={(args, side) => (side === 'own' ? <CrashOwnPill args={args} /> : <CrashOpponentPill args={args} />)}
      suppressResultOverlay
      {...props}
    />
  );
}
