import type { FastifyInstance } from 'fastify';
import type { Matchmaking } from '@rapidclash/core';

export function registerGamesRoutes(app: FastifyInstance, matchmaking: Matchmaking): void {
  app.get('/games', async (_request, reply) => {
    reply.send(matchmaking.listGames());
  });
}
