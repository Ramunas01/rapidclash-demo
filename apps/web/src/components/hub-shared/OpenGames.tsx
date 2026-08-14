import type { OpenChallenge } from '@rapidclash/shared';

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
 *  or `null` if the stake is covered. Plain numbers, not `formatCredits` (issue #324): this is a
 *  plain string, not JSX, so the RC icon can't live inside it — same "credit" word-not-symbol
 *  convention already used by `GamesCarousel.tsx`'s JOIN `aria-label`. */
export function insufficientBalanceNotice(stake: number, balance: number): string | null {
  if (balance >= stake) return null;
  return `Not enough credits to join — needs ${stake.toLocaleString('en-US')}, you have ${balance.toLocaleString('en-US')}.`;
}
