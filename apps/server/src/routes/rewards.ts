import type { FastifyInstance } from 'fastify';
import type { Rewards } from '@rapidclash/core';
import type { RewardsSnapshot, RewardsClaimResponse } from '@rapidclash/shared';
import type { makeAuthMiddleware } from '../middleware/auth.js';

// 10/minute/player (issue #306) — a real player hitting CLAIM once (or a double-tap) stays
// well under this; a scripted hammer does not. Same shape as guest-auth.ts's rate limit
// (issue #270): scoped to this one route via `config.rateLimit`, requires @fastify/rate-limit
// registered with `global: false` (server.ts) so no other route is affected. The endpoint is
// ALSO idempotent by construction (Rewards.claim — see rewards.ts core module), so this limit
// is a cheap extra guard against abuse, not the correctness mechanism.
const REWARDS_CLAIM_RATE_LIMIT_MAX = 10;
const REWARDS_CLAIM_RATE_LIMIT_WINDOW = '1 minute';

/**
 * `GET /rewards` + `POST /rewards/claim` (issue #306). All reward math (XP, tier, rakeback,
 * volume bonus) is computed server-side only, at match settlement / month-close — the client
 * here only ever reads the derived snapshot and triggers a claim; it never computes or submits
 * a reward figure itself.
 */
export function registerRewardsRoutes(
  app: FastifyInstance,
  auth: ReturnType<typeof makeAuthMiddleware>,
  rewards: Rewards,
): void {
  const { requireAuth } = auth;

  // GET /rewards — the authenticated player's own derived rewards snapshot (tier, rakeback
  // rate, XP progress to next tier, claimable balance). Mirrors GET /wallet's shape/pattern.
  app.get('/rewards', { preHandler: [requireAuth] }, async (request, reply) => {
    const playerId = request.player!.id;
    const body: RewardsSnapshot = rewards.getSnapshot(playerId);
    return reply.send(body);
  });

  // POST /rewards/claim — no body: always claims the player's OWN whole claimable_balance.
  // Idempotent (Rewards.claim): a double-tap after the first claim already zeroed the balance
  // finds nothing to claim and returns `credited: 0`, not an error.
  app.post(
    '/rewards/claim',
    {
      preHandler: [requireAuth],
      config: {
        rateLimit: {
          max: REWARDS_CLAIM_RATE_LIMIT_MAX,
          timeWindow: REWARDS_CLAIM_RATE_LIMIT_WINDOW,
        },
      },
    },
    async (request, reply) => {
      const playerId = request.player!.id;
      const body: RewardsClaimResponse = rewards.claim(playerId);
      return reply.code(200).send(body);
    },
  );
}
