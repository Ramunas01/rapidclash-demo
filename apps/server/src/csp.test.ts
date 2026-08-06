import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { EMBED_ALLOWED_ORIGINS } from '@rapidclash/shared';
import { createServices, buildApp } from './server.js';
import { rpsModule } from '@rapidclash/game-rps';
import { coinflipModule } from '@rapidclash/game-coinflip';

// Framability CSP (GUEST_MODE_CONTRACT.md §3, issue #271): the guest surface is embedded via
// <iframe> from the landing site — allow it with `frame-ancestors`, and never send
// X-Frame-Options (it would fight/override frame-ancestors in older browsers).

describe('CSP frame-ancestors (app-wide)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const db = new Database(':memory:');
    const services = createServices(db, [rpsModule, coinflipModule]);
    app = buildApp(services, [rpsModule, coinflipModule], { seedAdmin: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sends frame-ancestors with every allowed embed origin on an API route', async () => {
    const res = await app.inject({ method: 'GET', url: '/games' });
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();
    for (const origin of EMBED_ALLOWED_ORIGINS) {
      expect(csp).toContain(origin);
    }
  });

  it('sends frame-ancestors on a plain unknown GET too (app-wide, not scoped to one route)', async () => {
    const res = await app.inject({ method: 'GET', url: '/some-client-route' });
    expect(res.headers['content-security-policy']).toContain('frame-ancestors');
  });

  it('never sends X-Frame-Options — it would conflict with frame-ancestors', async () => {
    const res = await app.inject({ method: 'GET', url: '/games' });
    expect(res.headers['x-frame-options']).toBeUndefined();
  });
});
