import type { FastifyInstance } from 'fastify';
import type { Ledger } from '@rapidclash/core';
import type { AdminCreditBody } from '@rapidclash/shared';
import type { makeAuthMiddleware } from '../middleware/auth.js';

export function registerAdminRoutes(
  app: FastifyInstance,
  auth: ReturnType<typeof makeAuthMiddleware>,
  ledger: Ledger,
): void {
  const { requireAuth, requireAdmin } = auth;
  const preHandler = [requireAuth, requireAdmin];

  app.get('/admin/players', { preHandler }, async (_request, reply) => {
    reply.code(501).send({ error: 'Not implemented' });
  });

  app.get<{ Params: { id: string } }>('/admin/players/:id/log', { preHandler }, async (_request, reply) => {
    reply.code(501).send({ error: 'Not implemented' });
  });

  app.post<{ Params: { id: string }; Body: AdminCreditBody }>(
    '/admin/players/:id/credit',
    { preHandler },
    async (request, reply) => {
      const { id } = request.params;
      const { amount, idempotencyKey } = request.body;

      if (!Number.isInteger(amount) || amount <= 0) {
        return reply.code(400).send({ error: 'amount must be a positive integer' });
      }

      if (!ledger.accountExists(id)) {
        return reply.code(404).send({ error: 'Player not found' });
      }

      const entry = ledger.adminCredit(id, amount, idempotencyKey);
      return reply.code(200).send(entry);
    },
  );

  app.delete<{ Params: { id: string } }>('/admin/players/:id', { preHandler }, async (_request, reply) => {
    reply.code(501).send({ error: 'Not implemented' });
  });
}
