import type { FastifyInstance } from 'fastify';
import type { Matchmaking, MatchHistory } from '@rapidclash/core';
import type { GameModule, GameState, Outcome, PlayerId, RecentMatchesResponse } from '@rapidclash/shared';
import type { makeAuthMiddleware } from '../middleware/auth.js';

/**
 * Read-only detail for a single match. For an in-progress match `state` is the
 * requesting player's `viewFor` view, so the opponent's concealed move is never
 * leaked (invariant #2 / S5). For a completed match the state is terminal (fully
 * revealed) and the viewer's own settlement is included.
 */
interface MatchDetail {
  matchId: string;
  gameId: string;
  players: PlayerId[];
  status: 'in_progress' | 'completed';
  state: GameState;
  outcome?: Outcome;
  settlement?: { delta: number; newBalance: number };
}

export function registerMatchesRoutes(
  app: FastifyInstance,
  auth: ReturnType<typeof makeAuthMiddleware>,
  matchmaking: Matchmaking,
  gameModules: GameModule[],
  matchHistory: MatchHistory,
): void {
  const { requireAuth } = auth;
  const moduleByGame = new Map<string, GameModule>(gameModules.map((m) => [m.meta.id, m]));

  // GET /matches/recent — the CALLING PLAYER's own recent match history (issue #400), scoped
  // strictly to `request.player!.id`: there is no playerId route/query param, so a player can
  // never request another player's history. Registered ahead of the `/matches/:id` param route
  // below purely for readability — Fastify's router (find-my-way) always prefers a static
  // segment ('recent') over a param one at the same depth, so the two can never collide
  // regardless of registration order, but listing the more-specific route first reads clearer.
  // `?limit=`/`?offset=` are plain strings off the querystring; getRecentMatches clamps/defaults
  // them (default 10, cap 50) — a malformed or malicious value never reaches raw SQL as NaN or
  // forces a wasteful scan.
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/matches/recent',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const playerId = request.player!.id;
      const { limit, offset } = request.query;
      const body: RecentMatchesResponse = matchHistory.getRecentMatches(
        playerId,
        limit !== undefined ? Number(limit) : undefined,
        offset !== undefined ? Number(offset) : undefined,
      );
      return reply.send(body);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/matches/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const viewerId = request.player!.id;
      const { id } = request.params;

      const active = matchmaking.getActiveMatch(id);
      if (active) {
        if (!active.players.includes(viewerId)) {
          return reply.code(403).send({ error: 'You are not a player in this match' });
        }
        const mod = moduleByGame.get(active.gameId);
        const detail: MatchDetail = {
          matchId: active.matchId,
          gameId: active.gameId,
          players: active.players,
          status: 'in_progress',
          state: mod ? mod.viewFor(active.state, viewerId) : active.state,
        };
        return reply.send(detail);
      }

      const done = matchmaking.getCompletedMatch(id);
      if (done) {
        if (!done.players.includes(viewerId)) {
          return reply.code(403).send({ error: 'You are not a player in this match' });
        }
        const mod = moduleByGame.get(done.gameId);
        const s = done.settlement[viewerId];
        const detail: MatchDetail = {
          matchId: done.matchId,
          gameId: done.gameId,
          players: done.players,
          status: 'completed',
          state: mod ? mod.viewFor(done.state, viewerId) : done.state,
          outcome: done.outcome,
          ...(s ? { settlement: { delta: s.delta, newBalance: s.newBalance } } : {}),
        };
        return reply.send(detail);
      }

      return reply.code(404).send({ error: `No match found for "${id}"` });
    },
  );
}
