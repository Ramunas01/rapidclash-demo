import type { FastifyInstance } from 'fastify';
import type { MatchHistory } from '@rapidclash/core';

export function registerLeaderboardRoutes(app: FastifyInstance, matchHistory: MatchHistory): void {
  app.get<{ Params: { gameId: string } }>('/leaderboard/:gameId', async (request, reply) => {
    return reply.send(matchHistory.getLeaderboard(request.params.gameId));
  });

  // Games-hero "Popularity" sort (issue #465): all-time settled-match count per gameId. Public,
  // same as /leaderboard/:gameId — aggregate counts, not per-player data.
  app.get('/games/popularity', async (_request, reply) => {
    return reply.send(matchHistory.getPopularity());
  });
}
