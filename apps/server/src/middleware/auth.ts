import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Identity, UserRole } from '@rapidclash/core';

declare module 'fastify' {
  interface FastifyRequest {
    player?: { id: string; role: UserRole };
  }
}

export function makeAuthMiddleware(identity: Identity) {
  async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Missing or invalid Authorization header' });
      return;
    }
    const token = authHeader.slice(7);
    try {
      const payload = identity.verifyToken(token);
      request.player = { id: payload.sub, role: payload.role };
    } catch {
      reply.code(401).send({ error: 'Invalid or expired token' });
    }
  }

  async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await requireAuth(request, reply);
    if (reply.sent) return;
    if (request.player?.role !== 'admin') {
      reply.code(403).send({ error: 'Admin access required' });
    }
  }

  return { requireAuth, requireAdmin };
}
