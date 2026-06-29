import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { Outcome } from '@rapidclash/shared';

/** The three slot-pill verdicts (the green/red/orange outline convention). */
export type Verdict = 'win' | 'lose' | 'draw';

/**
 * The deliberate beat (ms) between the opponent's value landing and your colour lighting up — the
 * player reads the altitude/pick BEFORE the verdict (CRASH_HUB stage-3 #5). Shared so every
 * hidden-commit reveal (Crash, Coinflip, …) uses the same choreography.
 */
export const SLOT_OUTLINE_BEAT_MS = 500;

/** Map a server `Outcome` to THIS player's verdict for the pill outline. Driven strictly by the
 *  server result — never a client-side winner recompute. `void` → no outline. */
export function outlineForOutcome(outcome: Outcome | null | undefined, playerId: string | null): Verdict | null {
  if (!outcome) return null;
  if (outcome.type === 'draw') return 'draw';
  if (outcome.type === 'void') return null;
  return outcome.winner === playerId ? 'win' : 'lose';
}

/** Win/lose/draw ring classes for a slot pill, shared across the hidden-commit reveals. */
export function outlineClasses(outline: Verdict | null | undefined): string {
  return cn(
    outline === 'win' && 'ring-[3px] ring-success shadow-[0_0_12px_rgba(34,197,94,0.5)]',
    outline === 'lose' && 'ring-[3px] ring-destructive shadow-[0_0_12px_rgba(239,68,68,0.45)]',
    outline === 'draw' && 'ring-[3px] ring-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.45)]',
  );
}

/** Delay a flag by `ms` after it goes true — the reveal→beat→outline choreography. */
export function useDelayedFlag(active: boolean, ms: number): boolean {
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

/**
 * A generic slot-pill: locked content + the win/lose/draw outline. The shared shape behind the
 * Crash ("Locked 345m" / "Crashed") and Coinflip (HEADS/TAILS) reveals — the content is the game's,
 * the pill chrome + outline convention are shared.
 */
export function SlotPill({
  children,
  outline,
  busted,
  testid,
}: {
  children: ReactNode;
  outline?: Verdict | null;
  busted?: boolean;
  testid?: string;
}) {
  return (
    <span
      data-testid={testid}
      className={cn(
        'flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-extrabold uppercase tracking-wide',
        busted ? 'bg-destructive/15 text-destructive' : 'bg-background text-foreground',
        outlineClasses(outline),
      )}
    >
      {children}
    </span>
  );
}
