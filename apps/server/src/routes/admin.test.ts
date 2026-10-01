import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';
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

    expect(services.ledger.getBalance(bobId, 'USD')).toBe(GRANT_AMOUNT + 500);
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
    expect(services.ledger.getBalance(carolId, 'USD')).toBe(GRANT_AMOUNT + 200);
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

// AppOptions.onWrite (issue #378) — the durable-persistence hook that fires the GCS
// snapshotter's debounced trigger() on non-settlement writes. Scoped strictly to
// /admin/players/:id/credit — clear-password is out of scope for #378 and untouched.
describe('POST /admin/players/:id/credit — onWrite hook (issue #378)', () => {
  it('fires onWrite exactly once on a successful credit', async () => {
    const onWrite = vi.fn();
    const db = new Database(':memory:');
    const services = createServices(db, []);
    const app = buildApp(services, [], { seedAdmin: false, onWrite });
    try {
      const adminResult = await services.identity.register('admin', 'adminpw', 'admin');
      const playerReg = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { username: 'alice', password: 'pw' },
      });
      const { playerId } = playerReg.json<{ playerId: string }>();
      onWrite.mockClear(); // ignore the registration's own onWrite call above

      const res = await app.inject({
        method: 'POST',
        url: `/admin/players/${playerId}/credit`,
        headers: { authorization: `Bearer ${adminResult.token}` },
        payload: { amount: 500, idempotencyKey: 'onwrite-check' },
      });
      expect(res.statusCode).toBe(200);
      expect(onWrite).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('does NOT fire onWrite on a 400 (invalid amount)', async () => {
    const onWrite = vi.fn();
    const db = new Database(':memory:');
    const services = createServices(db, []);
    const app = buildApp(services, [], { seedAdmin: false, onWrite });
    try {
      const adminResult = await services.identity.register('admin', 'adminpw', 'admin');
      const playerReg = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { username: 'bob', password: 'pw' },
      });
      const { playerId } = playerReg.json<{ playerId: string }>();
      onWrite.mockClear();

      const res = await app.inject({
        method: 'POST',
        url: `/admin/players/${playerId}/credit`,
        headers: { authorization: `Bearer ${adminResult.token}` },
        payload: { amount: 0, idempotencyKey: 'bad-amount' },
      });
      expect(res.statusCode).toBe(400);
      expect(onWrite).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('does NOT fire onWrite on a 404 (unknown playerId)', async () => {
    const onWrite = vi.fn();
    const db = new Database(':memory:');
    const services = createServices(db, []);
    const app = buildApp(services, [], { seedAdmin: false, onWrite });
    try {
      const adminResult = await services.identity.register('admin', 'adminpw', 'admin');
      onWrite.mockClear();

      const res = await app.inject({
        method: 'POST',
        url: '/admin/players/00000000-0000-0000-0000-000000000000/credit',
        headers: { authorization: `Bearer ${adminResult.token}` },
        payload: { amount: 100, idempotencyKey: 'no-such-player' },
      });
      expect(res.statusCode).toBe(404);
      expect(onWrite).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
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
    expect(services.ledger.getBalance(playerId, 'USD')).toBe(GRANT_AMOUNT * 2);
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
    expect(services.ledger.getBalance(playerId, 'USD')).toBe(GRANT_AMOUNT * 2);
    const credits = services.ledger.getEntries(playerId).filter((e) => e.type === 'ADMIN_CREDIT');
    expect(credits).toHaveLength(1);
  });

  it('refuses (409) while the player has an unsettled escrow (active match / resting challenge)', async () => {
    services.ledger.escrow(playerId, 'live-match', 100, 'USD');
    const res = await clearPassword(playerId);
    expect(res.statusCode).toBe(409);
    // Nothing was changed: no password cleared (login still works), no grant written.
    expect(services.ledger.getBalance(playerId, 'USD')).toBe(GRANT_AMOUNT - 100);
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
    const balanceBeforeClear = services.ledger.getBalance(playerId, 'USD');
    await clearPassword(playerId);
    const balanceAfterClear = services.ledger.getBalance(playerId, 'USD');
    expect(balanceAfterClear).toBe(balanceBeforeClear + GRANT_AMOUNT);

    // Re-register the freed alias (the re-claim path on /auth/register).
    const reclaim = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'alice', password: 'new-pw' },
    });
    expect(reclaim.statusCode).toBe(201);
    const body = reclaim.json<{ playerId: string; balances: Record<string, number> }>();
    expect(body.playerId).toBe(playerId); // SAME account — standings preserved
    expect(body.balances.USD).toBe(balanceAfterClear); // no extra grant from the re-claim

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
      services.ledger.escrow(a, matchId, stake, 'USD');
      services.ledger.escrow(b, matchId, stake, 'USD');
      services.ledger.settle(matchId, 'win', winner, stake * 2, 0.05, 'USD');
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
    expect(services.ledger.getBalance(players.alice, 'USD')).toBeGreaterThan(0); // wallet was credited

    const after = services.matchHistory.getLeaderboard('coinflip');
    // Identical ranks, scores, displayNames — the null-match_id credit is excluded.
    expect(after).toEqual(before);

    // ELO ratings live in a separate derivation (replayed from match_results) and are
    // likewise untouched by a wallet credit. This coinflip fixture has no ELO board;
    // the equality above plus the null match_id is the proof for net_winnings. For ELO
    // games (Chess) the same holds by construction — the rating replay
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

// Ticket 2026-10-01#7: investor-demo-link attribution + the GET /admin/players and
// GET /admin/players/:id/log endpoints they were stubbed out for.
describe('GET /admin/players and /admin/players/:id/log (ticket 2026-10-01#7)', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeEach(async () => {
    const { app: a, services } = makeApp();
    app = a;
    const adminResult = await services.identity.register('admin', 'adminpw', 'admin');
    adminToken = adminResult.token;
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /auth/register captures the X-Demo-Link header as source, surfaced on /admin/players', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { 'x-demo-link': 'investor-walkthrough' },
      payload: { username: 'viaLink', password: 'pw' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/players',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const players = res.json<{ displayName: string; source: string | null }[]>();
    expect(players.find((p) => p.displayName === 'viaLink')?.source).toBe('investor-walkthrough');
  });

  it('a registration with no X-Demo-Link header shows source: null — direct traffic, not an error', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'direct', password: 'pw' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/players',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const players = res.json<{ displayName: string; source: string | null }[]>();
    expect(players.find((p) => p.displayName === 'direct')?.source).toBeNull();
  });

  it('/admin/players lists every account, unfiltered by source (Owner-confirmed: the frontend owns any filter toggle)', async () => {
    await app.inject({ method: 'POST', url: '/auth/register', headers: { 'x-demo-link': 'link-a' }, payload: { username: 'tagged', password: 'pw' } });
    await app.inject({ method: 'POST', url: '/auth/register', payload: { username: 'untagged', password: 'pw' } });
    const res = await app.inject({ method: 'GET', url: '/admin/players', headers: { authorization: `Bearer ${adminToken}` } });
    const names = res.json<{ displayName: string }[]>().map((p) => p.displayName);
    expect(names).toEqual(expect.arrayContaining(['admin', 'tagged', 'untagged']));
  });

  it('/admin/players includes each account\'s real USD balance and game stats', async () => {
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { username: 'balanced', password: 'pw' } });
    const { playerId } = reg.json<{ playerId: string }>();
    const res = await app.inject({ method: 'GET', url: '/admin/players', headers: { authorization: `Bearer ${adminToken}` } });
    const player = res.json<{ playerId: string; balance: number; gamesPlayed: number }[]>().find((p) => p.playerId === playerId);
    expect(player?.balance).toBe(GRANT_AMOUNT);
    expect(player?.gamesPlayed).toBe(0);
  });

  it('GET /admin/players/:id/log returns 404 for an unknown playerId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/players/does-not-exist/log',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /admin/players/:id/log returns the account\'s own ledger entries and match log', async () => {
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { username: 'logged', password: 'pw' } });
    const { playerId } = reg.json<{ playerId: string }>();

    const res = await app.inject({
      method: 'GET',
      url: `/admin/players/${playerId}/log`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ matches: unknown[]; ledgerEntries: { type: string }[] }>();
    expect(body.matches).toEqual([]); // no matches played yet
    expect(body.ledgerEntries.some((e) => e.type === 'GRANT')).toBe(true); // the registration grant
  });

  it('requires admin auth — a player token gets 403 on both endpoints, same as the existing admin routes', async () => {
    const playerReg = await app.inject({ method: 'POST', url: '/auth/register', payload: { username: 'nonadmin', password: 'pw' } });
    const { token: playerToken, playerId } = playerReg.json<{ token: string; playerId: string }>();

    const listRes = await app.inject({ method: 'GET', url: '/admin/players', headers: { authorization: `Bearer ${playerToken}` } });
    expect(listRes.statusCode).toBe(403);

    const logRes = await app.inject({ method: 'GET', url: `/admin/players/${playerId}/log`, headers: { authorization: `Bearer ${playerToken}` } });
    expect(logRes.statusCode).toBe(403);
  });

  it('/admin/players includes a lastSeenAt timestamp (ticket 2026-10-01#10, item 2) — present from the registration grant alone', async () => {
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { username: 'freshacct', password: 'pw' } });
    const { playerId } = reg.json<{ playerId: string }>();
    const res = await app.inject({ method: 'GET', url: '/admin/players', headers: { authorization: `Bearer ${adminToken}` } });
    const player = res.json<{ playerId: string; lastSeenAt: string | null }[]>().find((p) => p.playerId === playerId);
    expect(player?.lastSeenAt).not.toBeNull();
  });
});

// Ticket 2026-10-01#10, item 4 — the real bug Owner's hands-on use surfaced: the detail log was
// silently USD-only (both getFullMatchLog's own ledger query AND this route's ledgerEntries
// filter), dropping every match a SOL-default player ever settled. Exercised at the HTTP layer —
// the core-level regression already lives in match-history.test.ts — to confirm the route itself
// doesn't re-introduce a currency filter on top of a now-fixed getFullMatchLog.
describe('GET /admin/players/:id/log — non-USD currency (ticket 2026-10-01#10)', () => {
  let app: FastifyInstance;
  let services: ReturnType<typeof createServices>;
  let adminToken: string;

  beforeEach(async () => {
    const db = new Database(':memory:');
    services = createServices(db, [COINFLIP_NET_STUB]);
    app = buildApp(services, [COINFLIP_NET_STUB], { seedAdmin: false });
    const adminResult = await services.identity.register('admin', 'adminpw', 'admin');
    adminToken = adminResult.token;
  });

  afterEach(async () => {
    await app.close();
  });

  it('a match settled in SOL appears in the log and its ledger rows are not filtered out', async () => {
    const alice = await services.identity.register('alice', 'pw');
    const bob = await services.identity.register('bob', 'pw');
    services.ledger.escrow(alice.playerId, 'm1', 100, 'SOL');
    services.ledger.escrow(bob.playerId, 'm1', 100, 'SOL');
    services.ledger.settle('m1', 'win', alice.playerId, 200, 0.05, 'SOL');
    services.matchHistory.recordResult('m1', 'coinflip', [alice.playerId, bob.playerId], 'win', alice.playerId, 100);

    const res = await app.inject({
      method: 'GET',
      url: `/admin/players/${alice.playerId}/log`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ matches: { matchId: string; currency: string }[]; ledgerEntries: { currency: string }[] }>();
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0]).toMatchObject({ matchId: 'm1', currency: 'SOL' });
    expect(body.ledgerEntries.some((e) => e.currency === 'SOL')).toBe(true);
  });
});
