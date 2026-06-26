import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { KenoView } from '../App.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

// ── Presentation constants (cosmetic; the SERVER is authoritative). ────────────────────────────
const POOL_SIZE = 40;
const PICK_COUNT = 8;
const PICK_SECONDS = 20;

/** Keno moves (mirror the module's enumerable set). */
type KenoMove =
  | { t: 'pick'; n: number }
  | { t: 'unpick'; n: number }
  | { t: 'clear' }
  | { t: 'lock' }
  | { t: 'autofill' };

/** Greyed idle preview — the 1..40 pool before a match activates. */
function KenoIdle({ phase }: { phase: GameAreaArgs['phase'] }) {
  return (
    <div className="flex flex-col items-center gap-4 py-1">
      <div aria-hidden className="grid w-full grid-cols-8 gap-1 rounded-xl border border-border bg-surface/40 p-2 opacity-50">
        {Array.from({ length: POOL_SIZE }, (_, i) => i + 1).map((n) => (
          <div key={n} className="flex aspect-square items-center justify-center rounded-md bg-background text-[10px] font-bold text-muted-foreground">
            {n}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {phase === 'waiting' ? 'Waiting for an opponent…' : 'Choose a bet and press PLAY, or JOIN an open challenge'}
      </p>
    </div>
  );
}

/** The drawn numbers + match tally, public once a round resolves (shown for the locked-wait and
 *  the brief replay re-deal; the decisive win/lose surfaces the shared GameHub result overlay). */
function DrawReveal({ view, playerId, opponentId }: { view: KenoView; playerId: string | null; opponentId: string | null }) {
  const r = view.lastResult;
  if (!r || playerId == null) return null;
  const mine = r.matched[playerId] ?? 0;
  const theirs = opponentId ? (r.matched[opponentId] ?? 0) : 0;
  const myPicks = new Set(r.picks[playerId] ?? []);
  return (
    <div data-testid="draw-reveal" className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface/60 p-3">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">The draw</span>
      <div className="flex flex-wrap justify-center gap-1">
        {r.draw.map((n) => (
          <span
            key={n}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full text-xs font-black tabular-nums',
              myPicks.has(n) ? 'bg-success text-white' : 'bg-background text-foreground',
            )}
          >
            {n}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3 text-sm font-bold tabular-nums">
        <span className="text-foreground">You matched {mine}</span>
        <span className="text-muted-foreground">vs</span>
        <span className="text-foreground">Opp {theirs}</span>
      </div>
      {mine === theirs && !view.winner && !view.forcedOutcome && (
        <span data-testid="replay-note" className="text-xs font-medium text-amber-500">Tied — replaying (round {(view.round ?? 0) + 1})</span>
      )}
    </div>
  );
}

/**
 * The live Keno board. While picking, the player chooses PICK_COUNT spots on the 1..40 pool
 * (hidden from the opponent until both lock — server redaction); LOCK is disabled until exactly
 * PICK_COUNT are chosen. After both lock the shared draw is revealed and matches are compared.
 */
function KenoBoard({ playerId, opponentId, gameState, onMove }: GameAreaArgs) {
  const view = gameState as KenoView | null;
  const send = onMove as unknown as (m: KenoMove) => void;

  const me = playerId ? view?.picks?.[playerId] : undefined;
  const picks = me?.picks ?? [];
  const locked = me?.locked ?? false;
  const full = picks.length === PICK_COUNT;
  const pickedSet = new Set(picks);
  const round = view?.round ?? 0;

  // Cosmetic 20s countdown (server runs the authoritative clock). Reset on any of my picks / round.
  const [secondsLeft, setSecondsLeft] = useState(PICK_SECONDS);
  const resetKey = `${round}:${picks.length}:${locked}`;
  useEffect(() => {
    setSecondsLeft(PICK_SECONDS);
    if (locked) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [resetKey, locked]);

  const toggle = (n: number) => {
    if (locked) return;
    if (pickedSet.has(n)) send({ t: 'unpick', n });
    else if (picks.length < PICK_COUNT) send({ t: 'pick', n });
  };

  if (locked) {
    return (
      <div className="flex flex-col gap-3" data-testid="hub-board">
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface/40 p-5 text-center">
          <span data-testid="locked-banner" className="text-sm font-bold text-brand">Locked in {me?.autoFilled ? '(auto-fill)' : ''}</span>
          <span className="text-xs text-muted-foreground">Waiting for your opponent to lock…</span>
        </div>
        {view && <DrawReveal view={view} playerId={playerId} opponentId={opponentId} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="hub-board">
      <div className="flex items-center justify-between text-xs">
        <span data-testid="pick-indicator" className={cn('font-bold tabular-nums', full ? 'text-success' : 'text-foreground')}>
          {full ? `✓ ${PICK_COUNT} spots chosen` : `Pick ${PICK_COUNT - picks.length} more (${picks.length}/${PICK_COUNT})`}
        </span>
        <span
          data-testid="pick-timer"
          className={cn('flex h-6 min-w-6 items-center justify-center rounded-full border px-2 text-[11px] font-bold tabular-nums', secondsLeft <= 5 ? 'border-destructive/50 bg-destructive/10 text-destructive' : 'border-border bg-surface text-muted-foreground')}
        >
          {secondsLeft}s
        </span>
      </div>

      <div className="grid grid-cols-8 gap-1" role="grid" aria-label="Keno pool">
        {Array.from({ length: POOL_SIZE }, (_, i) => i + 1).map((n) => {
          const picked = pickedSet.has(n);
          return (
            <button
              key={n}
              type="button"
              data-testid={`spot-${n}`}
              aria-pressed={picked}
              onClick={() => toggle(n)}
              disabled={!picked && full}
              className={cn(
                'flex aspect-square items-center justify-center rounded-md text-xs font-bold tabular-nums transition-transform active:scale-95 disabled:opacity-40',
                picked ? 'bg-brand text-white ring-2 ring-amber-400' : 'bg-background text-foreground hover:bg-surface',
              )}
            >
              {n}
            </button>
          );
        })}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          data-testid="clear-btn"
          onClick={() => picks.length > 0 && send({ t: 'clear' })}
          disabled={picks.length === 0}
          className="flex-1 rounded-xl border border-border bg-surface py-2.5 text-sm font-semibold text-foreground/80 transition-colors hover:brightness-110 disabled:opacity-40"
        >
          Clear
        </button>
        <button
          type="button"
          data-testid="lock-btn"
          onClick={() => full && send({ t: 'lock' })}
          disabled={!full}
          className={cn('flex-[2] rounded-xl py-2.5 text-sm font-black uppercase tracking-wide text-white transition-colors', full ? 'bg-brand hover:brightness-110' : 'cursor-not-allowed bg-brand/40')}
        >
          {full ? 'Lock picks' : `Pick ${PICK_COUNT - picks.length} more`}
        </button>
      </div>
      <button
        type="button"
        data-testid="auto-btn"
        onClick={() => send({ t: 'autofill' })}
        className="text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        Auto-fill the rest &amp; lock
      </button>

      {view?.lastResult && <DrawReveal view={view} playerId={playerId} opponentId={opponentId} />}
    </div>
  );
}

/** The Keno game-area slot: greyed idle preview, or the live pick board in-match. */
function KenoPanel(args: GameAreaArgs) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      {args.phase === 'in-match' ? <KenoBoard {...args} /> : <KenoIdle phase={args.phase} />}
    </div>
  );
}

/**
 * Keno Hub = the shared GameHub + a Keno play-panel (the 1..40 pick board, lock, shared-draw
 * reveal). Both players secretly pick 8 spots; one shared seeded draw of 10 falls; more matches
 * wins the play-money pot. Server-authoritative redaction (picks hidden until both lock), the
 * per-player 20s pick timer, and the internal replay are unchanged. See docs/KENO.md.
 */
export function KenoHubScreen(props: GameHubScreenProps) {
  return <GameHub gameId="keno" gameName="Keno" renderGameArea={KenoPanel} {...props} />;
}
