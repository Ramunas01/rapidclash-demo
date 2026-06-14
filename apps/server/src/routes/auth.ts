import type { FastifyInstance } from 'fastify';
import type { Identity } from '@rapidclash/core';
import type { AuthRegisterBody, AuthLoginBody, AuthResponse } from '@rapidclash/shared';

export function registerAuthRoutes(app: FastifyInstance, identity: Identity): void {
  app.post<{ Body: AuthRegisterBody }>('/auth/register', async (request, reply) => {
    const { username, password } = request.body;
    try {
      const result = await identity.register(username, password);
      const body: AuthResponse = { token: result.token, playerId: result.playerId, balance: result.balance };
      reply.code(201).send(body);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'DUPLICATE_USERNAME') {
        reply.code(409).send({ error: 'Username already taken' });
      } else {
        throw err;
      }
    }
  });

  app.post<{ Body: AuthLoginBody }>('/auth/login', async (request, reply) => {
    const { username, password } = request.body;
    try {
      const result = await identity.login(username, password);
      const body: AuthResponse = { token: result.token, playerId: result.playerId, balance: result.balance };
      reply.code(200).send(body);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'INVALID_CREDENTIALS') {
        reply.code(401).send({ error: 'Invalid credentials' });
      } else {
        throw err;
      }
    }
  });
}
