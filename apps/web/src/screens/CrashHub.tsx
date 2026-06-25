import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Outcome } from '@rapidclash/shared';
import type { CrashView, GameView } from '../App.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

/** Display-only mirror of the server's curve + auto-eject ladder (packages/games/crash
 *  `CRASH_CONFIG`). The client animates the SAME shared climb from the server's `startedAt`; the
 *  server stays authoritative for the bank/crash, so a little latency drift here is fine. The slow
 *  start means a sub-second hiccup near launch skips almost no altitude. */
const SCALE = 5;
const GROWTH = 0.3;
const AUTO_LADDER = [50, 100, 200, 350, 500, 750, 1000, 1500];
function altitudeAt(elapsedMs: number): number {
  const s = Math.max(0, elapsedMs) / 1000;
  return Math.floor(SCALE * (Math.exp(GROWTH * s) - 1));
}

/** A 100ms local ticker (smooth countdown/climb) while the round is live and we're still aboard;
 *  it interpolates toward the server's fixed instants rather than re-rendering off sparse frames. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [active]);
  return now;
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

/**
 * Live Crash board across the three phases — SETUP (pre-set your auto-eject), IGNITION (a brief
 * beat), then the CLIMB (watch the shared altitude rise, EJECT before it crashes). Phase is
 * derived from the server's public `setupEndsAt`/`startedAt`, interpolated locally so the
 * countdown is smooth and both players stay synced. The opponent's nerve (and the crash altitude)
 * stay hidden until the round resolves — a blind duel.
 */
function CrashBoard({ gameState, legalMoves, onMove, playerId }: GameAreaArgs) {
  const view = gameState as CrashView | null;
  const startedAt = view?.startedAt ?? 0;
  const setupEndsAt = view?.setupEndsAt ?? 0;
  const myResult = (playerId && view?.results?.[playerId]) || undefined;
  const myAuto = (playerId && view?.autoEject?.[playerId]) ?? null;
  const done = Boolean(myResult);

  const now = useNow(Boolean(startedAt) && !done);
  const inSetup = !done && startedAt > 0 && now < setupEndsAt;
  const inIgnition = !done && startedAt > 0 && now >= setupEndsAt && now < startedAt;
  const liveAltitude = altitudeAt(now - startedAt);
  // EJECT is server-gated to the climb (a pad tap is rejected); gate on the phase, not the
  // transient legalMoves, but still require the server to currently offer a move.
  const canEject = !done && startedAt > 0 && now >= startedAt && legalMoves.length > 0;

  // ── SETUP: pre-set the auto-eject (a server move, hidden from the opponent) ──────────────
  if (inSetup) {
    const countdownSec = Math.max(1, Math.ceil((setupEndsAt - now) / 1000));
    return (
      <div data-testid="hub-board" className="flex min-h-[240px] flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl bg-surface p-6 text-center">
        <span className="text-4xl" aria-hidden="true">🚀</span>
        <p data-testid="crash-countdown" className="text-2xl font-black tabular-nums text-foreground">Launching in {countdownSec}…</p>
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Auto-eject (optional)</p>
        <div data-testid="crash-auto-eject" className="grid grid-cols-4 gap-1.5">
          {AUTO_LADDER.map((alt) => (
            <button
              key={alt}
              type="button"
              data-testid={`crash-auto-${alt}`}
              onClick={() => onMove(`auto:${alt}`)}
              className={cn(
                'rounded-lg px-2 py-1.5 text-xs font-bold tabular-nums transition-colors',
                myAuto === alt ? 'bg-brand text-white' : 'bg-background text-muted-foreground hover:text-foreground',
              )}
            >
              {alt}m
            </button>
          ))}
          <button
            type="button"
            data-testid="crash-auto-off"
            onClick={() => onMove('auto:off')}
            className={cn(
              'rounded-lg px-2 py-1.5 text-xs font-bold transition-colors',
              myAuto == null ? 'bg-brand text-white' : 'bg-background text-muted-foreground hover:text-foreground',
            )}
          >
            Off
          </button>
        </div>
      </div>
    );
  }

  // ── IGNITION: a brief beat before the climb ─────────────────────────────────────────────
  if (inIgnition) {
    return (
      <div data-testid="hub-board" className="flex min-h-[240px] flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl bg-surface p-6 text-center">
        <span className="text-5xl" aria-hidden="true">🔥</span>
        <p data-testid="crash-ignition" className="text-2xl font-black uppercase tracking-wider text-foreground">Ignition…</p>
        {myAuto != null && <p className="text-xs text-muted-foreground">Auto-eject armed at {myAuto} m</p>}
      </div>
    );
  }

  // ── CLIMB (and the post-eject "waiting" beat) ───────────────────────────────────────────
  const altitude = done ? (myResult!.crashed ? liveAltitude : myResult!.altitude) : liveAltitude;
  return (
    <div data-testid="hub-board" className="flex min-h-[240px] flex-col items-center justify-center gap-4 overflow-hidden rounded-2xl bg-surface p-6">
      <div className="text-center">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Altitude</p>
        <p
          data-testid="crash-altitude"
          className={cn('text-5xl font-black tabular-nums', done && myResult!.crashed ? 'text-destructive' : 'text-foreground')}
        >
          {altitude}<span className="text-2xl font-bold text-muted-foreground"> m</span>
        </p>
      </div>

      {done ? (
        <div className="text-center" data-testid="crash-own-result">
          {myResult!.crashed ? (
            <p className="text-sm font-bold text-destructive">💥 You crashed — banked 0</p>
          ) : (
            <p className="text-sm font-bold text-success">✓ Ejected at {myResult!.altitude} m</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">Waiting for the round to resolve…</p>
        </div>
      ) : (
        <>
          <button
            type="button"
            data-testid="crash-eject"
            disabled={!canEject}
            onClick={() => onMove('eject')}
            className="w-full max-w-xs rounded-xl bg-brand py-4 text-lg font-black uppercase tracking-wider text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Eject
          </button>
          {myAuto != null && <p className="text-xs text-muted-foreground">Auto-eject armed at {myAuto} m</p>}
        </>
      )}
    </div>
  );
}

function CrashPanel(args: GameAreaArgs) {
  return args.phase === 'in-match' ? <CrashBoard {...args} /> : <CrashIdle phase={args.phase} />;
}

/** Result reveal: the crash altitude C + both players' banks, revealed by the server at terminal. */
function CrashReveal({ gameState, playerId }: { outcome: Outcome; gameState: GameView | null; playerId: string | null }) {
  const view = gameState as CrashView | null;
  if (!view || !playerId) return null;
  const opp = view.players.find((p) => p !== playerId);
  const mine = view.results[playerId];
  const theirs = opp ? view.results[opp] : undefined;
  const fmt = (r?: { altitude: number; crashed: boolean }) => (r ? (r.crashed ? '💥' : `${r.altitude} m`) : '—');
  return (
    <div className="mb-3" data-testid="hub-result-crash">
      {view.crashAltitude != null && (
        <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-destructive">
          Rocket crashed at {view.crashAltitude} m
        </p>
      )}
      <div className="flex items-center justify-center gap-4">
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">You</p>
          <p className="text-xl font-black tabular-nums text-foreground">{fmt(mine)}</p>
        </div>
        <span className="text-xs font-black text-muted-foreground">VS</span>
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Opponent</p>
          <p className="text-xl font-black tabular-nums text-foreground">{fmt(theirs)}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Crash Hub = the shared GameHub + a Crash play-panel (SETUP auto-eject presets, ignition beat,
 * the climbing altitude readout + EJECT) and a final reveal. The shared seeded crash, the
 * eject/bust logic, the auto-eject schedule, redaction and settlement are all server-authoritative
 * — this is the presentation client.
 */
export function CrashHubScreen(props: GameHubScreenProps) {
  return (
    <GameHub
      gameId="crash"
      gameName="Crash"
      renderGameArea={CrashPanel}
      renderResultReveal={CrashReveal}
      {...props}
    />
  );
}
