import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { createServices, buildApp, type AppServices } from '../server.js';
import type { AuthResponse } from '@rapidclash/shared';

// Issue #270: POST /auth/guest is public and cheap-but-not-free per session (in-memory
// ledger entry). @fastify/rate-limit is scoped ONLY to this route (server.ts registers it
// with `global: false`; the cap lives in guest-auth.ts's route `config`) — proves both the
// block path (a hammer past the cap) and the non-block path (normal clicking/reloading).

function makeApp(): { app: FastifyInstance; services: AppServices } {
  const db = new Database(':memory:');
  const services = createServices(db, []);
  const app = buildApp(services, [], { seedAdmin: false });
  return { app, services };
}

describe('POST /auth/guest rate limiting (issue #270)', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    ({ app } = makeApp());
  });

  afterEach(async () => {
    await app.close();
  });

  async function requestGuest() {
    return app.inject({ method: 'POST', url: '/auth/guest' });
  }

  it('a single IP creating guest sessions faster than the cap (5/minute) gets a 429, not a 201, on the 6th request', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await requestGuest();
      expect(res.statusCode).toBe(201);
    }
    const sixth = await requestGuest();
    expect(sixth.statusCode).toBe(429);
    const body = sixth.json<{ error?: string; message?: string }>();
    // The generic req() client helper in apps/web/src/api.ts surfaces `err.error` verbatim —
    // confirm the plugin's default body carries a reasonably clear one, not a raw 429.
    expect(body.error).toBeTruthy();
  });

  it('normal usage (a handful of clicks/reloads well under the cap) is never rate-limited', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await requestGuest();
      expect(res.statusCode).toBe(201);
      const authBody = res.json<AuthResponse>();
      expect(authBody.isGuest).toBe(true);
    }
  });

  it('the limiter is scoped to POST /auth/guest only — a route with no rate-limit config is unaffected by the same burst', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({ method: 'GET', url: '/open-challenges' });
      expect(res.statusCode).toBe(200);
    }
  });
});
