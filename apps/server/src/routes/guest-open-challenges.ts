import type { FastifyInstance } from 'fastify';
import type { Matchmaking } from '@rapidclash/core';
import type { PublicOpenChallenge } from '@rapidclash/shared';

/** No viewer to exclude — every caller sees the same shared bot pool (mirrors
 *  `routes/open-challenges.ts`'s NO_VIEWER; the empty string is never a valid playerId). */
const NO_VIEWER = '';

/**
 * `usernameFor()`'s bot label (`apps/server/src/guest/index.ts`'s `usernameFor`, line ~301) —
 * duplicated as a literal rather than imported, matching this codebase's existing precedent
 * (grep "Demo Opponent" — `guest.test.ts`/`chess-bot-pool.test.ts`/`blackjack-bot-pool.test.ts`/
 * the gateway tests all already re-assert this exact literal rather than importing a shared
 * constant). Filtering on it is what turns `listOpenChallenges`' raw resting entries (which don't
 * expose the underlying playerId) into a bots-only view: any OTHER resting entry in the shared
 * guest `Matchmaking` instance (e.g. a guest who posted an off-lane stake nothing has claimed yet)
 * resolves to `usernameFor`'s OTHER branch, `'Guest'` — never this string — so it's excluded here.
 */
const DEMO_BOT_OWNER_NAME = 'Demo Opponent 🤖';

/**
 * `GET /guest/open-challenges` (issue #354, part 5/5 of
 * `docs/COMMS/from-advisor/guest-mode-bot-economy.md` §D) — a guest-scoped read of the ISOLATED
 * guest `Matchmaking` instance's currently-resting Demo-Opponent bot-waiters (issue #351's
 * multi-stake pools), for the client's "who's on duty" list. Deliberately mirrors
 * `registerOpenChallengesRoutes` (`routes/open-challenges.ts`)'s public-snapshot shape — same
 * `PublicOpenChallenge[]` response, same no-auth GET, same NO_VIEWER read — but sourced from
 * `guest.matchmaking`, never the real one passed to that route. This is the ENTIRE isolation
 * guarantee: the data can never contain real-player rows because it is never asked to read the
 * real `Matchmaking` instance in the first place (verify-by-construction, per the issue's own
 * acceptance criterion) — no gameId/playerId filtering trick is doing that job.
 *
 * Bot-only, not "everything currently resting": the shared guest `Matchmaking` instance can also
 * hold a real (human) guest's own off-lane resting stake (e.g. one of `BET_PRESETS` outside
 * `GUEST_BOT_STAKE_LANES` — see `guest/index.ts`'s "transition window" comment) while waiting on
 * `#352`'s bot-taker to claim it, or the sweep/TTL to refund it. That is not a "Demo-Opponent on
 * duty" and must not render as one alongside them — filtered out by `DEMO_BOT_OWNER_NAME` above.
 */
export function registerGuestOpenChallengesRoutes(app: FastifyInstance, guestMatchmaking: Matchmaking): void {
  app.get('/guest/open-challenges', async (_request, reply) => {
    const rows: PublicOpenChallenge[] = [];
    for (const meta of guestMatchmaking.listGames()) {
      const { entries } = guestMatchmaking.listOpenChallenges(meta.id, NO_VIEWER);
      for (const c of entries) {
        if (c.ownerName !== DEMO_BOT_OWNER_NAME) continue;
        rows.push({ gameId: meta.id, ...c });
      }
    }
    // Stable, readable ordering: grouped by game, cheapest stake first within a game.
    rows.sort((a, b) => (a.gameId === b.gameId ? a.stake - b.stake : a.gameId.localeCompare(b.gameId)));
    reply.send(rows);
  });
}
