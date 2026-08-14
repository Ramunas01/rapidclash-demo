import type { OpenChallenge } from '@rapidclash/shared';
import { formatCredits } from '../../format.js';

/** How often the logged-out carousel re-polls the public snapshot so the feed visibly moves
 *  (`GamesCarousel.tsx`'s `useOpenChallengesPool`, issue #305). */
export const PUBLIC_POLL_MS = 4_000;

/** One feed row — the shape `GamesCarousel.tsx` (issue #305) draws its rolling window from. */
export type FeedRow = { gameId: string; c: OpenChallenge };

/** Flattens the per-game WS feed into one oldest-first row list — reused by `GamesCarousel.tsx`'s
 *  OPEN GAMES tab (issue #305: "reuse the existing feed, don't build a new path"). */
export function mergeChallengesByGame(challengesByGame: Record<string, OpenChallenge[]>): FeedRow[] {
  const out: FeedRow[] = [];
  for (const [gameId, list] of Object.entries(challengesByGame)) for (const c of list) out.push({ gameId, c });
  return out.sort((a, b) => a.c.openedAt - b.c.openedAt);
}

/** The one balance-affordability check every JOIN action runs before taking a challenge — reused
 *  by `GamesCarousel.tsx` (issue #305) instead of reinventing it. Returns the notice text to show,
 *  or `null` if the stake is covered. */
export function insufficientBalanceNotice(stake: number, balance: number): string | null {
  if (balance >= stake) return null;
  return `Not enough credits to join — needs ${formatCredits(stake)}, you have ${formatCredits(balance)}.`;
}
