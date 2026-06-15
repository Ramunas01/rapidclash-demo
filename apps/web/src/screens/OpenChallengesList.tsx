import { useEffect, useState } from 'react';
import type { OpenChallenge, ChallengesUpdatePayload } from '@rapidclash/shared';
import { formatClock } from '../format.js';

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

export function OpenChallengesList({ entries, more, onTake, notice }: Props) {
  // ONE client-side timer drives every countdown: remaining = expiresAt − now.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // The list is simply ABSENT when nothing is eligible (OC2) — unless there's a notice to show.
  if (entries.length === 0 && !notice) return null;

  return (
    <div style={{ marginTop: 24 }} data-testid="open-challenges">
      <h2 style={{ fontSize: '1rem', color: 'var(--muted)', marginBottom: 8 }}>Open challenges</h2>
      {notice && (
        <p className="error-msg" data-testid="challenge-notice">
          {notice}
        </p>
      )}
      {entries.map((e) => (
        <button
          key={e.matchId}
          className="lb-row oc-row"
          onClick={() => onTake(e.matchId)}
          data-testid={`challenge-${e.matchId}`}
          aria-label={`Take ${e.ownerName}'s ${e.stake} credit challenge`}
        >
          <span className="lb-name">{e.ownerName}</span>
          <span className="lb-stat">{e.stake} credits</span>
          <span className="lb-stat" data-testid={`countdown-${e.matchId}`}>
            ⏳ {formatClock(e.expiresAt - now)}
          </span>
        </button>
      ))}
      {more > 0 && (
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: 8 }} data-testid="more-waiting">
          +{more} more waiting
        </p>
      )}
    </div>
  );
}
