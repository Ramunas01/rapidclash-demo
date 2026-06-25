import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Outcome } from '@rapidclash/shared';
import type { CrashView, GameView } from '../App.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

/** Display-only mirror of the server's altitude curve (packages/games/crash `CRASH_CONFIG`).
 *  The client animates the SAME shared climb from the server's `startedAt`; the server stays
 *  authoritative for the bank/crash, so a little latency drift here is fine. */
const ALTITUDE_RATE = 10;
const ALTITUDE_EXP = 2;
function altitudeAt(elapsedMs: number): number {
  const s = Math.max(0, elapsedMs) / 1000;
  return Math.floor(ALTITUDE_RATE * Math.pow(s, ALTITUDE_EXP));
}

/** Pre-game / waiting board — no rocket yet; it launches on match.start. */
function CrashIdle({ phase }: { phase: GameAreaArgs['phase'] }) {
  return (
    <div data-testid="hub-board" className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl bg-surface p-6 text-center">
      <span className="text-5xl" aria-hidden="true">🚀</span>
      <p className="text-sm font-semibold text-muted-foreground">
        {phase === 'waiting' ? 'Finding a rival…' : 'Place your bet and launch'}
      </p>
    </div>
  );
}

/**
 * Live Crash board: the shared rocket's altitude climbs from `startedAt` (display-only), with an
 * EJECT button (gated by the server's legalMoves) and an optional client-side auto-eject. The
 * opponent's nerve is hidden until the round resolves (viewFor) — a blind duel.
 */
function CrashBoard({ gameState, legalMoves, onMove, playerId }: GameAreaArgs) {
  const view = gameState as CrashView | null;
  const canEject = legalMoves.length > 0;
  const startedAt = view?.startedAt ?? 0;
  const myResult = (playerId && view?.results?.[playerId]) || undefined;
  const done = Boolean(myResult);

  // Climb locally between server frames; freeze once we've ejected/crashed.
  const [elapsed, setElapsed] = useState(() => (startedAt ? Date.now() - startedAt : 0));
  useEffect(() => {
    if (!startedAt || done) return;
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 50);
    return () => clearInterval(id);
  }, [startedAt, done]);
  const liveAltitude = altitudeAt(elapsed);

  // Optional client-side auto-eject: fire EJECT once the climb reaches the chosen altitude.
  const [autoEject, setAutoEject] = useState<number | null>(null);
  const fired = useRef(false);
  useEffect(() => { fired.current = false; }, [startedAt]);
  useEffect(() => {
    if (canEject && !fired.current && autoEject != null && liveAltitude >= autoEject) {
      fired.current = true;
      onMove('eject');
    }
  }, [canEject, autoEject, liveAltitude, onMove]);

  const altitude = done ? (myResult!.crashed ? liveAltitude : myResult!.altitude) : liveAltitude;

  return (
    <div data-testid="hub-board" className="flex min-h-[220px] flex-col items-center justify-center gap-4 overflow-hidden rounded-2xl bg-surface p-6">
      {/* Altitude readout */}
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
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Auto-eject at</span>
            <input
              type="number"
              min={1}
              data-testid="crash-auto-eject"
              value={autoEject ?? ''}
              onChange={(e) => setAutoEject(e.target.value === '' ? null : Math.max(1, Number(e.target.value)))}
              placeholder="—"
              className="w-20 rounded-lg bg-background px-2 py-1 text-center text-foreground tabular-nums outline-none focus:ring-2 focus:ring-brand"
            />
            <span>m</span>
          </label>
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
 * Crash Hub = the shared GameHub + a Crash play-panel (the climbing altitude readout, EJECT, an
 * optional client-side auto-eject) and a final reveal. The shared seeded crash, the eject/bust
 * logic, redaction and settlement are all server-authoritative — this is the presentation client.
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
