import type { FastifyInstance } from 'fastify';
import { type Identity, isAvatarId } from '@rapidclash/core';
import type {
  AuthRegisterBody,
  AuthLoginBody,
  AuthResponse,
  SetAvatarBody,
  SetAvatarResponse,
} from '@rapidclash/shared';
import type { makeAuthMiddleware } from '../middleware/auth.js';

export function registerAuthRoutes(
  app: FastifyInstance,
  auth: ReturnType<typeof makeAuthMiddleware>,
  identity: Identity,
  onWrite?: () => void,
): void {
  const { requireAuth } = auth;

  app.post<{ Body: AuthRegisterBody }>('/auth/register', async (request, reply) => {
    const { username, password } = request.body;
    try {
      const result = await identity.register(username, password);
      const body: AuthResponse = {
        token: result.token,
        playerId: result.playerId,
        balance: result.balance,
        username,
        avatarId: result.avatarId,
      };
      // New account row — durable-persistence gap (issue #378): the GCS snapshot was
      // previously only triggered on match settlement, so a registration between the last
      // settlement and a redeploy could vanish. Fire the (debounced, cheap) hook on the
      // success path only — never from the DUPLICATE_USERNAME branch below.
      onWrite?.();
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
      const body: AuthResponse = {
        token: result.token,
        playerId: result.playerId,
        balance: result.balance,
        username,
        avatarId: result.avatarId,
      };
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

  // POST /auth/avatar — set the AUTHENTICATED player's OWN avatar (presets-only). The id is
  // validated against the AvatarId enum (reject anything else, 400). A user can only ever set
  // their own avatar — the id comes from the verified token (`request.player`), never the body.
  app.post<{ Body: SetAvatarBody }>('/auth/avatar', { preHandler: [requireAuth] }, async (request, reply) => {
    const avatarId = request.body?.avatarId;
    if (!isAvatarId(avatarId)) {
      return reply.code(400).send({ error: 'Invalid avatarId' });
    }
    identity.setAvatarId(request.player!.id, avatarId);
    const body: SetAvatarResponse = { avatarId };
    return reply.code(200).send(body);
  });
}
