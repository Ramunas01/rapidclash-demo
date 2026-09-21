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

  // Ticket 2026-09-21#8: on Cloud Run every request's TCP peer is the Google Front End proxy, never
  // the real visitor — without `trustProxy: true` (server.ts), `request.ip` resolves to the SAME
  // address for every visitor, collapsing this "5/minute/IP" limit into "5/minute, period" for the
  // whole site. `app.inject`'s own `remoteAddress` simulates that single shared proxy peer; distinct
  // `X-Forwarded-For` headers simulate distinct real visitors behind it.
  it("ticket 2026-09-21#8: trustProxy reads the real visitor from X-Forwarded-For, not the shared proxy's own peer address — two different visitors get SEPARATE quota buckets", async () => {
    const proxyPeer = '10.0.0.1'; // the one address every request would share without trustProxy
    async function requestFrom(visitorIp: string) {
      return app.inject({
        method: 'POST',
        url: '/auth/guest',
        remoteAddress: proxyPeer,
        headers: { 'x-forwarded-for': visitorIp },
      });
    }
    // Visitor A burns through their own 5/minute cap.
    for (let i = 0; i < 5; i++) {
      expect((await requestFrom('203.0.113.1')).statusCode).toBe(201);
    }
    expect((await requestFrom('203.0.113.1')).statusCode).toBe(429); // A is capped
    // Visitor B, a DIFFERENT real IP behind the SAME proxy peer, is completely unaffected —
    // this is exactly the "occasionally Rate exceeded" bug: without trustProxy, B would already
    // be capped here too, since A and B would share one bucket keyed on `proxyPeer`.
    expect((await requestFrom('203.0.113.2')).statusCode).toBe(201);
  });
});
