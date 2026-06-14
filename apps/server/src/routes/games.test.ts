import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { rpsModule } from '@rapidclash/game-rps';
import { createServices, buildApp } from '../server.js';

describe('GET /games', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    const db = new Database(':memory:');
    const services = createServices(db, [rpsModule]);
    app = buildApp(services, [rpsModule], { seedAdmin: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns an array containing RPS GameMeta', async () => {
    const res = await app.inject({ method: 'GET', url: '/games' });
    expect(res.statusCode).toBe(200);
    const games = res.json<Array<{ id: string; displayName: string }>>() ;
    expect(Array.isArray(games)).toBe(true);
    const rps = games.find((g) => g.id === 'rps');
    expect(rps).toBeDefined();
    expect(rps!.displayName).toBeTruthy();
  });

  it('returns 200 with no auth required', async () => {
    const res = await app.inject({ method: 'GET', url: '/games' });
    expect(res.statusCode).toBe(200);
  });
});
