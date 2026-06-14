import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { createServices, buildApp } from '../server.js';
import { GRANT_AMOUNT } from '@rapidclash/core';

function makeApp(): { app: FastifyInstance } {
  const db = new Database(':memory:');
  const services = createServices(db);
  const app = buildApp(services, { seedAdmin: false });
  return { app };
}

describe('POST /auth/register', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    ({ app } = makeApp());
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates an account and returns 201 with token, playerId, and balance', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'alice', password: 'hunter2' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ token: string; playerId: string; balance: number }>();
    expect(body.token).toBeTruthy();
    expect(body.playerId).toBeTruthy();
    expect(body.balance).toBe(GRANT_AMOUNT);
  });

  it('returns 409 on duplicate username', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'alice', password: 'pw1' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'alice', password: 'pw2' },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('POST /auth/login', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    ({ app } = makeApp());
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with a valid token on correct credentials', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'bob', password: 'secret' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'bob', password: 'secret' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ token: string; playerId: string }>();
    expect(body.token).toBeTruthy();
    expect(body.playerId).toBeTruthy();
  });

  it('returns 401 on wrong password', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'carol', password: 'right' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'carol', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 on unknown username', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'nobody', password: 'pw' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('admin routes — auth enforcement', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let playerToken: string;

  beforeEach(async () => {
    const db = new Database(':memory:');
    const services = createServices(db);
    app = buildApp(services, { seedAdmin: false });

    // Create admin directly via identity to control role (bypasses HTTP register which always creates players)
    const { identity } = services;
    const adminResult = await identity.register('superadmin', 'pw', 'admin');
    adminToken = adminResult.token;

    const playerReg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'player1', password: 'pw' },
    });
    playerToken = playerReg.json<{ token: string }>().token;
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/players' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when a player token is used on /admin/players', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/players',
      headers: { authorization: `Bearer ${playerToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 501 when an admin token is used on /admin/players', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/players',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(501);
  });
});
