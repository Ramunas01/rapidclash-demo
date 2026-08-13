import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { createServices, buildApp, type AppServices } from '../server.js';
import { GRANT_AMOUNT } from '@rapidclash/core';
import type { AuthResponse, LeaderboardEntry } from '@rapidclash/shared';

function makeApp(): { app: FastifyInstance; services: AppServices } {
  const db = new Database(':memory:');
  const services = createServices(db, []);
  const app = buildApp(services, [], { seedAdmin: false });
  return { app, services };
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
    const body = res.json<{ token: string; playerId: string; balance: number; username: string }>();
    expect(body.token).toBeTruthy();
    expect(body.playerId).toBeTruthy();
    expect(body.balance).toBe(GRANT_AMOUNT);
    // #34: the client needs its own alias to show "who you are".
    expect(body.username).toBe('alice');
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
    const body = res.json<{ token: string; playerId: string; username: string }>();
    expect(body.token).toBeTruthy();
    expect(body.playerId).toBeTruthy();
    // #34: login must also echo the alias back.
    expect(body.username).toBe('bob');
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

describe('avatar — AuthResponse field + POST /auth/avatar (Advisor #12 ii)', () => {
  let app: FastifyInstance;
  let services: AppServices;

  beforeEach(() => {
    ({ app, services } = makeApp());
  });
  afterEach(async () => {
    await app.close();
  });

  async function registerPlayer(username: string): Promise<{ token: string; body: AuthResponse }> {
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { username, password: 'pw' } });
    const body = res.json<AuthResponse>();
    return { token: body.token, body };
  }

  it('register returns avatarId "default" for a new account', async () => {
    const { body } = await registerPlayer('ada');
    expect(body.avatarId).toBe('default');
  });

  it('POST /auth/avatar sets the caller\'s avatar and login echoes it back (survives "reload")', async () => {
    const { token } = await registerPlayer('bea');
    const set = await app.inject({
      method: 'POST',
      url: '/auth/avatar',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarId: 'girl-light' },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json<{ avatarId: string }>().avatarId).toBe('girl-light');

    // A fresh login returns the stored avatar (persisted server-side).
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'bea', password: 'pw' } });
    expect(login.json<AuthResponse>().avatarId).toBe('girl-light');
  });

  it('accepts the #312 meme-style presets (hooded-mono, hooded-degen) — AVATAR_IDS server-side enforcement', async () => {
    const { token } = await registerPlayer('finn');
    for (const avatarId of ['hooded-mono', 'hooded-degen'] as const) {
      const set = await app.inject({
        method: 'POST',
        url: '/auth/avatar',
        headers: { authorization: `Bearer ${token}` },
        payload: { avatarId },
      });
      expect(set.statusCode).toBe(200);
      expect(set.json<{ avatarId: string }>().avatarId).toBe(avatarId);
    }
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'finn', password: 'pw' } });
    expect(login.json<AuthResponse>().avatarId).toBe('hooded-degen'); // last write wins, persisted
  });

  it('rejects an invalid avatarId with 400 and does not change the stored value', async () => {
    const { token } = await registerPlayer('cid');
    const bad = await app.inject({
      method: 'POST',
      url: '/auth/avatar',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarId: 'evil-hacker' },
    });
    expect(bad.statusCode).toBe(400);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'cid', password: 'pw' } });
    expect(login.json<AuthResponse>().avatarId).toBe('default'); // unchanged
  });

  it('requires auth — no token → 401 (a user cannot set an avatar unauthenticated)', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/avatar', payload: { avatarId: 'boy-dark' } });
    expect(res.statusCode).toBe(401);
  });

  it('leaderboard entries carry each player\'s stored avatarId (public board)', async () => {
    // Two players; give the winner a preset avatar.
    const { token, body } = await registerPlayer('dot');
    await registerPlayer('eli');
    const winnerId = body.playerId;
    await app.inject({
      method: 'POST',
      url: '/auth/avatar',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarId: 'boy-brown' },
    });
    // Record a finished match so both appear on the (win_rate default) board.
    const eliReg = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'eli', password: 'pw' } });
    const eliPlayerId = eliReg.json<AuthResponse>().playerId;
    services.matchHistory.recordResult('m1', 'rps', [winnerId, eliPlayerId], 'win', winnerId, 10);

    const res = await app.inject({ method: 'GET', url: '/leaderboard/rps' });
    const entries = res.json<LeaderboardEntry[]>();
    const winner = entries.find((e) => e.playerId === winnerId)!;
    const loser = entries.find((e) => e.playerId === eliPlayerId)!;
    expect(winner.avatarId).toBe('boy-brown');
    expect(loser.avatarId).toBe('default');
  });
});

describe('admin routes — auth enforcement', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let playerToken: string;

  beforeEach(async () => {
    const db = new Database(':memory:');
    const services = createServices(db, []);
    app = buildApp(services, [], { seedAdmin: false });

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
