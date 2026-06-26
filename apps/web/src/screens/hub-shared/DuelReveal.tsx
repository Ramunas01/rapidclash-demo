import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * One side of a hidden-commit reveal. `value` is a pre-formatted, **unit-agnostic** string
 * ("900 m", "x2.40", "7 hits", …) so this template carries no game knowledge — the host hub
 * formats it. `busted` flags a wipeout (rendered in the destructive tone with a 💥).
 */
export interface DuelRevealPlayer {
  label: string;
  value: string;
  busted?: boolean;
}

/**
 * Reusable end-of-round reveal for the hidden-commit duel games: two locked values side by side,
 * an optional verdict line, an optional pot/delta line. The drama of Crash, Limbo, Keno and Mines
 * is the same shape — both players commit blind, then the lock lifts and you compare — so this is
 * the shared payoff template (refinement #5). It is deliberately altitude-agnostic: the "m" unit,
 * the 0 m-bust wording and the crash-point caption are Crash-side adapters in `CrashReveal`, not
 * here. `verdict`/`pot` are optional — omit them when the host `GameHub` overlay already renders
 * the win/lose headline + settlement (Crash does); pass them when a game suppresses that overlay.
 */
export function DuelReveal({
  players,
  verdict,
  pot,
}: {
  players: [DuelRevealPlayer, DuelRevealPlayer];
  verdict?: ReactNode;
  pot?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2" data-testid="duel-reveal">
      <div className="flex items-stretch justify-center gap-3">
        {players.map((p, i) => (
          <Fragment key={p.label + i}>
            {i === 1 && <span className="self-center text-xs font-black text-muted-foreground">VS</span>}
            <div
              className={cn(
                'min-w-[92px] rounded-xl border px-4 py-2 text-center',
                p.busted ? 'border-destructive/40 bg-destructive/10' : 'border-border bg-surface/60',
              )}
            >
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{p.label}</p>
              <p className={cn('text-xl font-black tabular-nums', p.busted ? 'text-destructive' : 'text-foreground')}>
                {p.busted && <span aria-hidden="true">💥 </span>}
                {p.value}
              </p>
            </div>
          </Fragment>
        ))}
      </div>
      {verdict != null && <p className="text-sm font-black text-foreground">{verdict}</p>}
      {pot != null && <p className="text-xs font-semibold text-muted-foreground">{pot}</p>}
    </div>
  );
}
