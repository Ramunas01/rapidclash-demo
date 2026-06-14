import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { createServices, buildApp } from '../server.js';
import { GRANT_AMOUNT } from '@rapidclash/core';

function makeApp() {
  const db = new Database(':memory:');
  const services = createServices(db, []);
  const app = buildApp(services, [], { seedAdmin: false });
  return { app, services };
}

describe('POST /admin/players/:id/credit', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let playerToken: string;
  let playerId: string;

  beforeEach(async () => {
    const { app: a, services } = makeApp();
    app = a;

    // Create admin directly via identity to control role
    const adminResult = await services.identity.register('admin', 'adminpw', 'admin');
    adminToken = adminResult.token;

    // Create a regular player via the HTTP route
    const playerReg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'alice', password: 'pw' },
    });
    const playerBody = playerReg.json<{ token: string; playerId: string }>();
    playerToken = playerBody.token;
    playerId = playerBody.playerId;
  });

  afterEach(async () => {
    await app.close();
  });

  it('credits the player and returns 200 with the ledger entry', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/admin/players/${playerId}/credit`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { amount: 500, idempotencyKey: 'top-up-1' },
    });
    expect(res.statusCode).toBe(200);
    const entry = res.json<{ type: string; amount: number; idempotencyKey: string }>();
    expect(entry.type).toBe('ADMIN_CREDIT');
    expect(entry.amount).toBe(500);
    expect(entry.idempotencyKey).toBe('top-up-1');
  });

  it('balance increases by the credited amount', async () => {
    const { services } = makeApp();
    // Need a fresh isolated setup to check balance
    const adminRes = await services.identity.register('admin2', 'pw', 'admin');
    const freshApp = buildApp(services, [], { seedAdmin: false });

    const regRes = await freshApp.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'bob', password: 'pw' },
    });
    const { playerId: bobId } = regRes.json<{ playerId: string }>();

    await freshApp.inject({
      method: 'POST',
      url: `/admin/players/${bobId}/credit`,
      headers: { authorization: `Bearer ${adminRes.token}` },
      payload: { amount: 500, idempotencyKey: 'top-up-bob' },
    });

    expect(services.ledger.getBalance(bobId)).toBe(GRANT_AMOUNT + 500);
    await freshApp.close();
  });

  it('replaying the same idempotencyKey returns 200 with the same entry and does not double-credit', async () => {
    const { services } = makeApp();
    const adminRes = await services.identity.register('admin3', 'pw', 'admin');
    const freshApp = buildApp(services, [], { seedAdmin: false });

    const regRes = await freshApp.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'carol', password: 'pw' },
    });
    const { playerId: carolId } = regRes.json<{ playerId: string }>();

    const first = await freshApp.inject({
      method: 'POST',
      url: `/admin/players/${carolId}/credit`,
      headers: { authorization: `Bearer ${adminRes.token}` },
      payload: { amount: 200, idempotencyKey: 'idem-key-1' },
    });
    const second = await freshApp.inject({
      method: 'POST',
      url: `/admin/players/${carolId}/credit`,
      headers: { authorization: `Bearer ${adminRes.token}` },
      payload: { amount: 200, idempotencyKey: 'idem-key-1' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json<{ id: string }>().id).toBe(second.json<{ id: string }>().id);
    expect(services.ledger.getBalance(carolId)).toBe(GRANT_AMOUNT + 200);
    await freshApp.close();
  });

  it('returns 400 when amount is 0', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/admin/players/${playerId}/credit`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { amount: 0, idempotencyKey: 'bad-amount' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when amount is negative', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/admin/players/${playerId}/credit`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { amount: -50, idempotencyKey: 'negative-amount' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 403 when a player token is used', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/admin/players/${playerId}/credit`,
      headers: { authorization: `Bearer ${playerToken}` },
      payload: { amount: 100, idempotencyKey: 'gate-check' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for an unknown playerId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/players/00000000-0000-0000-0000-000000000000/credit',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { amount: 100, idempotencyKey: 'no-such-player' },
    });
    expect(res.statusCode).toBe(404);
  });
});
