import type { FastifyInstance } from 'fastify';
import type { Ledger } from '@rapidclash/core';
import type { WalletResponse } from '@rapidclash/shared';
import type { makeAuthMiddleware } from '../middleware/auth.js';

export function registerWalletRoutes(
  app: FastifyInstance,
  auth: ReturnType<typeof makeAuthMiddleware>,
  ledger: Ledger,
): void {
  const { requireAuth } = auth;

  // GET /wallet — the player's derived balance + their ledger entries.
  // Balance is summed from the append-only ledger (invariant #3), never a stored number.
  app.get('/wallet', { preHandler: [requireAuth] }, async (request, reply) => {
    const playerId = request.player!.id;
    const body: WalletResponse = {
      balance: ledger.getBalance(playerId),
      entries: ledger.getEntries(playerId),
    };
    return reply.send(body);
  });
}
