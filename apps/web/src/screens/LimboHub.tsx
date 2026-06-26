import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { LimboView } from '../App.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

// ── Presentation constants (cosmetic; the SERVER is authoritative). ────────────────────────────
const PICK_SECONDS = 10;
const TARGET_LADDER = [1.1, 1.25, 1.5, 2, 3, 5, 10, 25, 50, 100, 1000, 10_000, 100_000, 1_000_000];

type LimboMove = { t: 'pick'; target: number } | { t: 'lock' } | { t: 'auto' };

const fmtMult = (t: number) => (t >= 1000 ? `${t.toLocaleString('en-US')}×` : `${t}×`);
/** Implied survival chance of a target (zero-edge: survival = 1/t). */
const fmtChance = (t: number) => {
  const pct = 100 / t;
  return pct >= 1 ? `${pct.toFixed(0)}%` : pct >= 0.01 ? `${pct.toFixed(2)}%` : '<0.01%';
};

function LimboIdle({ phase }: { phase: GameAreaArgs['phase'] }) {
  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <div aria-hidden className="text-4xl font-black text-muted-foreground/50">×?</div>
      <p className="text-xs text-muted-foreground">
        {phase === 'waiting' ? 'Waiting for an opponent…' : 'Choose a bet and press PLAY, or JOIN an open challenge'}
      </p>
    </div>
  );
}

/** The shared roll + both targets, public once a round resolves (locked-wait + replay re-deal). */
function RollReveal({ view, playerId, opponentId }: { view: LimboView; playerId: string | null; opponentId: string | null }) {
  const r = view.lastResult;
  if (!r || playerId == null) return null;
  const myT = r.targets[playerId];
  const oppT = opponentId ? r.targets[opponentId] : undefined;
  const cleared = (t: number | undefined) => t !== undefined && r.roll >= t;
  return (
    <div data-testid="roll-reveal" className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface/60 p-3">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Roll</span>
      <span data-testid="roll-value" className="text-3xl font-black tabular-nums text-foreground">{fmtMult(r.roll)}</span>
      <div className="flex items-center gap-4 text-sm font-bold tabular-nums">
        <span className={cn(cleared(myT) ? 'text-success' : 'text-destructive')}>You {myT !== undefined ? fmtMult(myT) : '—'}</span>
        <span className="text-muted-foreground">vs</span>
        <span className={cn(cleared(oppT) ? 'text-success' : 'text-destructive')}>Opp {oppT !== undefined ? fmtMult(oppT) : '—'}</span>
      </div>
      {r.winner === null && !view.winner && !view.forcedOutcome && (
        <span data-testid="replay-note" className="text-xs font-medium text-amber-500">Push — replaying (round {(view.round ?? 0) + 1})</span>
      )}
    </div>
  );
}

/**
 * The live Limbo board. The player secretly picks a target multiplier from the ladder (its implied
 * survival chance shown), hidden from the opponent until both lock. A shared zero-edge roll then
 * decides via the bravery rule. LOCK is disabled until a target is chosen.
 */
function LimboBoard({ playerId, opponentId, gameState, onMove }: GameAreaArgs) {
  const view = gameState as LimboView | null;
  const send = onMove as unknown as (m: LimboMove) => void;

  const me = playerId ? view?.picks?.[playerId] : undefined;
  const target = me?.target ?? null;
  const locked = me?.locked ?? false;
  const round = view?.round ?? 0;

  const [secondsLeft, setSecondsLeft] = useState(PICK_SECONDS);
  const resetKey = `${round}:${target}:${locked}`;
  useEffect(() => {
    setSecondsLeft(PICK_SECONDS);
    if (locked) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [resetKey, locked]);

  if (locked) {
    return (
      <div className="flex flex-col gap-3" data-testid="hub-board">
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface/40 p-5 text-center">
          <span data-testid="locked-banner" className="text-sm font-bold text-brand">Locked at {target !== null ? fmtMult(target) : '—'} {me?.auto ? '(auto)' : ''}</span>
          <span className="text-xs text-muted-foreground">Waiting for your opponent to lock…</span>
        </div>
        {view && <RollReveal view={view} playerId={playerId} opponentId={opponentId} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="hub-board">
      <div className="flex items-center justify-between text-xs">
        <span data-testid="target-indicator" className={cn('font-bold tabular-nums', target !== null ? 'text-success' : 'text-foreground')}>
          {target !== null ? `Target ${fmtMult(target)} · clears ${fmtChance(target)}` : 'Choose a target multiplier'}
        </span>
        <span
          data-testid="pick-timer"
          className={cn('flex h-6 min-w-6 items-center justify-center rounded-full border px-2 text-[11px] font-bold tabular-nums', secondsLeft <= 3 ? 'border-destructive/50 bg-destructive/10 text-destructive' : 'border-border bg-surface text-muted-foreground')}
        >
          {secondsLeft}s
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Target multiplier">
        {TARGET_LADDER.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={target === t}
            data-testid={`target-${t}`}
            onClick={() => send({ t: 'pick', target: t })}
            className={cn(
              'flex flex-col items-center rounded-lg border px-1 py-2 transition-transform active:scale-95',
              target === t ? 'border-amber-400 bg-brand text-white' : 'border-border bg-background text-foreground hover:bg-surface',
            )}
          >
            <span className="text-sm font-black tabular-nums">{fmtMult(t)}</span>
            <span className={cn('text-[9px] font-bold', target === t ? 'text-white/70' : 'text-muted-foreground')}>{fmtChance(t)}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        data-testid="lock-btn"
        onClick={() => target !== null && send({ t: 'lock' })}
        disabled={target === null}
        className={cn('rounded-xl py-2.5 text-sm font-black uppercase tracking-wide text-white transition-colors', target !== null ? 'bg-brand hover:brightness-110' : 'cursor-not-allowed bg-brand/40')}
      >
        {target !== null ? `Lock ${fmtMult(target)}` : 'Choose a target to lock'}
      </button>
      <button
        type="button"
        data-testid="auto-btn"
        onClick={() => send({ t: 'auto' })}
        className="text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        Auto-assign a target &amp; lock
      </button>

      {view?.lastResult && <RollReveal view={view} playerId={playerId} opponentId={opponentId} />}
    </div>
  );
}

function LimboPanel(args: GameAreaArgs) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      {args.phase === 'in-match' ? <LimboBoard {...args} /> : <LimboIdle phase={args.phase} />}
    </div>
  );
}

/**
 * Limbo Hub = the shared GameHub + a Limbo play-panel (the target ladder with implied survival
 * chances, lock, shared-roll reveal). Both players secretly pick a target; one shared zero-edge
 * roll decides via the bravery rule. Server-authoritative redaction (target hidden until both
 * lock), the per-player 10s pick timer, and the internal replay are unchanged. See docs/LIMBO.md.
 */
export function LimboHubScreen(props: GameHubScreenProps) {
  return <GameHub gameId="limbo" gameName="Limbo" renderGameArea={LimboPanel} {...props} />;
}
