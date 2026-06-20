import type { FastifyInstance } from 'fastify';
import type { Matchmaking } from '@rapidclash/core';
import type { PublicOpenChallenge } from '@rapidclash/shared';

/** No viewer to exclude — a logged-out reader sees every resting challenge. The empty string is
 *  not a valid playerId, so listOpenChallenges' `e.playerId !== viewerId` filter keeps them all. */
const NO_VIEWER = '';

/** Bound the cross-game payload regardless of how many games/bots are resting. (Each game's
 *  listOpenChallenges already self-caps; this is the overall ceiling for the public snapshot.) */
const PUBLIC_FEED_CAP = 24;

/**
 * Public (no requireAuth) cross-game snapshot of resting open challenges, for the logged-out
 * Home ticker so a visitor sees real, near-live movement (the bot crowd posting/clearing). The
 * authed WS feed (challenges.subscribe) stays the path for signed-in users; this read is the
 * logged-out equivalent. Read-only — the alias shown is the same one authed users already see.
 * Auth is still required to JOIN: the WS `challenge.take` rejects unauthenticated callers (#2).
 */
export function registerOpenChallengesRoutes(app: FastifyInstance, matchmaking: Matchmaking): void {
  app.get('/open-challenges', async (_request, reply) => {
    const rows: PublicOpenChallenge[] = [];
    for (const meta of matchmaking.listGames()) {
      const { entries } = matchmaking.listOpenChallenges(meta.id, NO_VIEWER);
      for (const c of entries) rows.push({ gameId: meta.id, ...c });
    }
    // Longest-waiting first (parity with the per-game feed), then bound the payload.
    rows.sort((a, b) => a.openedAt - b.openedAt);
    reply.send(rows.slice(0, PUBLIC_FEED_CAP));
  });
}
