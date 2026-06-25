import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Outcome } from '@rapidclash/shared';
import type { CrashView, GameView } from '../App.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

/** Display-only mirror of the server's altitude curve (packages/games/crash `CRASH_CONFIG`). The
 *  client animates the SAME shared climb from the server's `startedAt`, aligned to the server's
 *  clock (see `serverClockOffset`), so what the player sees matches what the server banks. The
 *  slow start (initial rate ≈ scale·growth) means a sub-second hiccup near launch skips almost no
 *  altitude. Exported for the client↔server agreement test. */
const SCALE = 0.8;
const GROWTH = 0.45;
/** Throttle the altitude number to ~4 Hz so it's readable (the countdown keeps its smooth tick). */
const ALTITUDE_THROTTLE_MS = 250;
export function altitudeAt(elapsedMs: number): number {
  const s = Math.max(0, elapsedMs) / 1000;
  return Math.floor(SCALE * (Math.exp(GROWTH * s) - 1));
}

/** A 100ms local ticker (smooth countdown/climb) while the round is live and we're still aboard. */
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
 * Live Crash board across the phases — a brief SETUP countdown, IGNITION, then the CLIMB (watch
 * the shared altitude rise, EJECT before it crashes). Phase + altitude are derived from the
 * server's public `setupEndsAt`/`startedAt`, with the local clock aligned to the server's via
 * `serverClockOffset` so the displayed altitude matches the altitude the server banks. The
 * opponent's nerve (and the crash altitude) stay hidden until the round resolves — a blind duel.
 */
function CrashBoard({ gameState, legalMoves, onMove, playerId, serverClockOffset = 0 }: GameAreaArgs) {
  const view = gameState as CrashView | null;
  const startedAt = view?.startedAt ?? 0;
  const setupEndsAt = view?.setupEndsAt ?? 0;
  const myResult = (playerId && view?.results?.[playerId]) || undefined;
  const done = Boolean(myResult);

  // Align the local tick to the SERVER clock (offset from the match payload) — otherwise the live
  // counter drifts from the server's authoritative altitudeAt(ctx.now − startedAt) on clock skew.
  const now = useNow(Boolean(startedAt) && !done) + serverClockOffset;
  const elapsed = now - startedAt;
  const inSetup = !done && startedAt > 0 && now < setupEndsAt;
  const inIgnition = !done && startedAt > 0 && now >= setupEndsAt && now < startedAt;
  // Throttle the displayed altitude to ~4 Hz so the number is readable as it accelerates.
  const displayElapsed = Math.floor(Math.max(0, elapsed) / ALTITUDE_THROTTLE_MS) * ALTITUDE_THROTTLE_MS;
  const liveAltitude = altitudeAt(displayElapsed);
  const canEject = !done && startedAt > 0 && now >= startedAt && legalMoves.length > 0;

  // ── SETUP: a short "get ready" countdown (live-EJECT only — no auto-eject input) ─────────
  if (inSetup) {
    const countdownSec = Math.max(1, Math.ceil((setupEndsAt - now) / 1000));
    return (
      <div data-testid="hub-board" className="flex min-h-[240px] flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl bg-surface p-6 text-center">
        <span className="text-4xl" aria-hidden="true">🚀</span>
        <p data-testid="crash-countdown" className="text-3xl font-black tabular-nums text-foreground">Launching in {countdownSec}…</p>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Get ready to eject</p>
      </div>
    );
  }

  // ── IGNITION: a brief beat before the climb ─────────────────────────────────────────────
  if (inIgnition) {
    return (
      <div data-testid="hub-board" className="flex min-h-[240px] flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl bg-surface p-6 text-center">
        <span className="text-5xl" aria-hidden="true">🔥</span>
        <p data-testid="crash-ignition" className="text-2xl font-black uppercase tracking-wider text-foreground">Ignition…</p>
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
        <button
          type="button"
          data-testid="crash-eject"
          disabled={!canEject}
          onClick={() => onMove('eject')}
          className="w-full max-w-xs rounded-xl bg-brand py-4 text-lg font-black uppercase tracking-wider text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Eject
        </button>
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
 * Crash Hub = the shared GameHub + a Crash play-panel (a short SETUP countdown, ignition, the
 * climbing altitude readout + EJECT) and a final reveal. Live-EJECT only for humans (the module
 * keeps its server-side auto-eject for bots). The shared seeded crash, the eject/bust logic,
 * redaction and settlement are all server-authoritative — this is the presentation client.
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
