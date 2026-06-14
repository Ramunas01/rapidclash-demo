import type { FastifyInstance } from 'fastify';
import type { makeAuthMiddleware } from '../middleware/auth.js';

export function registerAdminRoutes(
  app: FastifyInstance,
  auth: ReturnType<typeof makeAuthMiddleware>,
): void {
  const { requireAuth, requireAdmin } = auth;
  const preHandler = [requireAuth, requireAdmin];

  app.get('/admin/players', { preHandler }, async (_request, reply) => {
    reply.code(501).send({ error: 'Not implemented' });
  });

  app.get<{ Params: { id: string } }>('/admin/players/:id/log', { preHandler }, async (_request, reply) => {
    reply.code(501).send({ error: 'Not implemented' });
  });

  app.post<{ Params: { id: string } }>('/admin/players/:id/credit', { preHandler }, async (_request, reply) => {
    reply.code(501).send({ error: 'Not implemented' });
  });

  app.delete<{ Params: { id: string } }>('/admin/players/:id', { preHandler }, async (_request, reply) => {
    reply.code(501).send({ error: 'Not implemented' });
  });
}
