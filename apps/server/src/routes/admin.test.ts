import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import type { GameModule } from '@rapidclash/shared';
import { createServices, buildApp } from '../server.js';
import { GRANT_AMOUNT } from '@rapidclash/core';

function makeApp() {
  const db = new Database(':memory:');
  const services = createServices(db, []);
  const app = buildApp(services, [], { seedAdmin: false });
  return { app, services };
}

// A minimal stub module so matchHistory dispatches `coinflip` to the net_winnings
// leaderboard (ADR-007). Only `meta.id`/`meta.ranking` are read by createServices;
// the gameplay hooks are never invoked in these route tests.
const COINFLIP_NET_STUB = {
  meta: { id: 'coinflip', ranking: { kind: 'net_winnings' } },
} as unknown as GameModule;

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

describe('POST /admin/players/:id/clear-password (soft reset)', () => {
  let app: FastifyInstance;
  let services: ReturnType<typeof createServices>;
  let adminToken: string;
  let playerToken: string;
  let playerId: string;

  async function registerPlayer(username: string): Promise<{ token: string; playerId: string }> {
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { username, password: 'pw' } });
    return res.json<{ token: string; playerId: string }>();
  }

  function clearPassword(id: string, token = adminToken) {
    return app.inject({
      method: 'POST',
      url: `/admin/players/${id}/clear-password`,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  beforeEach(async () => {
    const db = new Database(':memory:');
    services = createServices(db, [COINFLIP_NET_STUB]);
    app = buildApp(services, [COINFLIP_NET_STUB], { seedAdmin: false });

    const admin = await services.identity.register('admin', 'adminpw', 'admin');
    adminToken = admin.token;
    const alice = await registerPlayer('alice');
    playerToken = alice.token;
    playerId = alice.playerId;
  });

  afterEach(async () => {
    await app.close();
  });

  it('clears the password, grants the starting credit, and returns playerId/username/newBalance', async () => {
    const res = await clearPassword(playerId);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ playerId: string; username: string; newBalance: number }>();
    expect(body.playerId).toBe(playerId);
    expect(body.username).toBe('alice');
    // Fresh grant appended on top of the signup grant (append-only ledger).
    expect(body.newBalance).toBe(GRANT_AMOUNT * 2);
    expect(services.ledger.getBalance(playerId)).toBe(GRANT_AMOUNT * 2);
  });

  it('the wallet grant is a NULL-match ADMIN_CREDIT entry', async () => {
    await clearPassword(playerId);
    const entries = services.ledger.getEntries(playerId);
    const credit = entries.find((e) => e.type === 'ADMIN_CREDIT');
    expect(credit).toBeDefined();
    expect(credit!.amount).toBe(GRANT_AMOUNT);
    expect(credit!.matchId).toBeUndefined(); // null match_id → excluded from standings
  });

  it('is idempotent: a retry does not issue a second grant', async () => {
    await clearPassword(playerId);
    const second = await clearPassword(playerId);
    expect(second.statusCode).toBe(200);
    // Still exactly one extra grant — the deterministic idempotency key dedupes.
    expect(services.ledger.getBalance(playerId)).toBe(GRANT_AMOUNT * 2);
    const credits = services.ledger.getEntries(playerId).filter((e) => e.type === 'ADMIN_CREDIT');
    expect(credits).toHaveLength(1);
  });

  it('refuses (409) while the player has an unsettled escrow (active match / resting challenge)', async () => {
    services.ledger.escrow(playerId, 'live-match', 100);
    const res = await clearPassword(playerId);
    expect(res.statusCode).toBe(409);
    // Nothing was changed: no password cleared (login still works), no grant written.
    expect(services.ledger.getBalance(playerId)).toBe(GRANT_AMOUNT - 100);
    await expect(services.identity.login('alice', 'pw')).resolves.toBeTruthy();
  });

  it('returns 404 for an unknown playerId', async () => {
    const res = await clearPassword('00000000-0000-0000-0000-000000000000');
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when a player (non-admin) token is used', async () => {
    const res = await clearPassword(playerId, playerToken);
    expect(res.statusCode).toBe(403);
  });

  it('frees the alias: register with the same name succeeds afterwards with NO second grant', async () => {
    const balanceBeforeClear = services.ledger.getBalance(playerId);
    await clearPassword(playerId);
    const balanceAfterClear = services.ledger.getBalance(playerId);
    expect(balanceAfterClear).toBe(balanceBeforeClear + GRANT_AMOUNT);

    // Re-register the freed alias (the re-claim path on /auth/register).
    const reclaim = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'alice', password: 'new-pw' },
    });
    expect(reclaim.statusCode).toBe(201);
    const body = reclaim.json<{ playerId: string; balance: number }>();
    expect(body.playerId).toBe(playerId); // SAME account — standings preserved
    expect(body.balance).toBe(balanceAfterClear); // no extra grant from the re-claim

    // New password authenticates; the old one no longer does.
    await expect(services.identity.login('alice', 'new-pw')).resolves.toBeTruthy();
    await expect(services.identity.login('alice', 'pw')).rejects.toThrow(/invalid credentials/i);
  });

  // ── Key correctness invariant (ADR-011) ───────────────────────────────────
  // net_winnings is derived only from match-linked ledger entries (non-null
  // match_id). The soft-reset ADMIN_CREDIT has a null match_id, so a clear must
  // leave the leaderboard byte-for-byte unchanged.
  it('INVARIANT: clear-password leaves the net_winnings leaderboard unchanged', async () => {
    const bob = await registerPlayer('bob');
    const carol = await registerPlayer('carol');
    const players = { alice: playerId, bob: bob.playerId, carol: carol.playerId };

    // Build a real leaderboard: several settled coinflip matches through the ledger.
    function playMatch(matchId: string, a: string, b: string, winner: string, stake: number) {
      services.ledger.escrow(a, matchId, stake);
      services.ledger.escrow(b, matchId, stake);
      services.ledger.settle(matchId, 'win', winner, stake * 2, 0.05);
      services.matchHistory.recordResult(matchId, 'coinflip', [a, b], 'win', winner, stake);
    }
    playMatch('m1', players.alice, players.bob, players.alice, 100);
    playMatch('m2', players.alice, players.carol, players.carol, 200);
    playMatch('m3', players.bob, players.carol, players.bob, 150);

    const before = services.matchHistory.getLeaderboard('coinflip');
    // Sanity: it really is a non-trivial net_winnings board.
    expect(before.length).toBe(3);
    expect(before.every((e) => e.kind === 'net_winnings')).toBe(true);

    // Soft-reset alice (no open escrow — every match settled).
    const res = await clearPassword(players.alice);
    expect(res.statusCode).toBe(200);
    expect(services.ledger.getBalance(players.alice)).toBeGreaterThan(0); // wallet was credited

    const after = services.matchHistory.getLeaderboard('coinflip');
    // Identical ranks, scores, displayNames — the null-match_id credit is excluded.
    expect(after).toEqual(before);

    // ELO ratings live in a separate derivation (replayed from match_results) and are
    // likewise untouched by a wallet credit. This coinflip fixture has no ELO board;
    // the equality above plus the null match_id is the proof for net_winnings. For ELO
    // games (Chess, Ships Battle) the same holds by construction — the rating replay
    // never reads the ledger, so an ADMIN_CREDIT cannot move a rating.
  });

  it('retires the old remove-account delete: DELETE still returns 501 (not implemented)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/players/${playerId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(501);
  });
});
