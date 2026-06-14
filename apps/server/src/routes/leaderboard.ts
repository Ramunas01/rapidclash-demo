import type { FastifyInstance } from 'fastify';
import type { MatchHistory } from '@rapidclash/core';

export function registerLeaderboardRoutes(app: FastifyInstance, matchHistory: MatchHistory): void {
  app.get<{ Params: { gameId: string } }>('/leaderboard/:gameId', async (request, reply) => {
    return reply.send(matchHistory.getLeaderboard(request.params.gameId));
  });
}
