import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, Coins, Swords } from 'lucide-react';
import type { OpenChallenge, ChallengesUpdatePayload } from '@rapidclash/shared';
import { formatClock, formatCredits } from '../format.js';
import { cn } from '@/lib/utils';

/**
 * Apply one incremental feed update to the current list (event-driven — OC8, no polling).
 * Removes by matchId, appends a new bet (dedup), and keeps longest-waiting-first order so
 * the top row is the same bet the typed-amount FIFO path would match.
 */
export function applyChallengesUpdate(
  entries: OpenChallenge[],
  update: ChallengesUpdatePayload,
): OpenChallenge[] {
  let next = entries;
  if (update.removed) {
    next = next.filter((e) => e.matchId !== update.removed!.matchId);
  }
  if (update.added && !next.some((e) => e.matchId === update.added!.matchId)) {
    next = [...next, update.added];
  }
  return [...next].sort((a, b) => a.openedAt - b.openedAt);
}

interface Props {
  entries: OpenChallenge[];
  more: number;
  onTake(matchId: string): void;
  /** Brief notice after a failed take (e.g. the bet was just taken). */
  notice?: string | null;
}

/** Two-letter monogram from an alias — a client-side avatar (no backend, no stored image). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const URGENT_MS = 10_000;

export function OpenChallengesList({ entries, more, onTake, notice }: Props) {
  // ONE client-side timer drives every countdown: remaining = expiresAt − now.
  // Cosmetic only — expiry is server-authoritative; this just animates the number.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // The list is simply ABSENT when nothing is eligible (OC2) — unless there's a notice to show.
  if (entries.length === 0 && !notice) return null;

  return (
    <div className="mt-6" data-testid="open-challenges">
      <div className="mb-3 flex items-center gap-2">
        <Swords className="h-4 w-4 text-brand" />
        <h2 className="text-sm font-semibold text-white/80">Open challenges</h2>
        {entries.length > 0 && (
          <span className="ml-auto flex items-center gap-1 text-xs text-white/40">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
            {entries.length} live
          </span>
        )}
      </div>

      {notice && (
        <div
          role="alert"
          data-testid="challenge-notice"
          className="mb-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-red-300"
        >
          {notice}
        </div>
      )}

      <div className="space-y-2">
        {entries.map((e, i) => {
          const remaining = e.expiresAt - now;
          const urgent = remaining <= URGENT_MS;
          return (
            <motion.button
              key={e.matchId}
              type="button"
              onClick={() => onTake(e.matchId)}
              data-testid={`challenge-${e.matchId}`}
              aria-label={`Take ${e.ownerName}'s ${e.stake} credit challenge`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.3 }}
              className="group flex w-full items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-3 text-left transition-all hover:border-brand/40 hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-purple-700 text-xs font-bold text-white">
                {initials(e.ownerName)}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-white">{e.ownerName}</span>
                  <span className="hidden text-[10px] font-medium uppercase tracking-wide text-white/40 sm:inline">
                    wants to play
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-brand">
                  <Coins className="h-3.5 w-3.5" />
                  <span className="text-sm font-bold" data-testid={`stake-${e.matchId}`}>
                    {formatCredits(e.stake)}
                  </span>
                </div>
              </div>

              <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                <span
                  className={cn(
                    'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums',
                    urgent ? 'bg-destructive/20 text-red-300' : 'bg-white/5 text-white/70',
                  )}
                  data-testid={`countdown-${e.matchId}`}
                >
                  <Clock className="h-3 w-3" />
                  {formatClock(remaining)}
                </span>
                <span className="flex items-center gap-1 text-[11px] font-semibold text-brand opacity-0 transition-opacity group-hover:opacity-100">
                  <Swords className="h-3 w-3" /> Take
                </span>
              </div>
            </motion.button>
          );
        })}
      </div>

      {more > 0 && (
        <p className="mt-2 text-center text-xs text-white/40" data-testid="more-waiting">
          +{more} more waiting
        </p>
      )}
    </div>
  );
}
