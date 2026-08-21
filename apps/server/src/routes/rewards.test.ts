import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { createServices, buildApp, type AppServices } from '../server.js';
import type { RewardsSnapshot, RewardsClaimResponse } from '@rapidclash/shared';

function makeApp(): { app: FastifyInstance; services: AppServices } {
  const db = new Database(':memory:');
  const services = createServices(db, []);
  const app = buildApp(services, [], { seedAdmin: false });
  return { app, services };
}

describe('GET /rewards + POST /rewards/claim (issue #306)', () => {
  let app: FastifyInstance;
  let services: AppServices;
  let token: string;
  let playerId: string;

  beforeEach(async () => {
    ({ app, services } = makeApp());
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'alice', password: 'pw' },
    });
    const body = reg.json<{ token: string; playerId: string }>();
    token = body.token;
    playerId = body.playerId;
  });

  afterEach(async () => {
    await app.close();
  });

  it('a fresh account reads back an all-zero, Unranked snapshot', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/rewards',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const snap = res.json<RewardsSnapshot>();
    expect(snap.xpLifetime).toBe(0);
    expect(snap.tier).toBe('Unranked');
    expect(snap.rakebackRate).toBe(0);
    expect(snap.claimableBalance).toBe(0);
    expect(snap.nextTier).toEqual({ tier: 'Wood', xpRequired: 500, rakebackRate: 0.01 });
  });

  it('GET /rewards returns 401 without a bearer token', async () => {
    const res = await app.inject({ method: 'GET', url: '/rewards' });
    expect(res.statusCode).toBe(401);
  });

  it('reflects accrual written directly through the Rewards service (server-side-only computation)', async () => {
    services.rewards.recordMatchSettlement(playerId, 100, 0.1, 'win');
    const res = await app.inject({
      method: 'GET',
      url: '/rewards',
      headers: { authorization: `Bearer ${token}` },
    });
    const snap = res.json<RewardsSnapshot>();
    expect(snap.xpLifetime).toBe(400); // round(40 * 100*0.1)
  });

  it('POST /rewards/claim with nothing accrued is a harmless no-op', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/rewards/claim',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<RewardsClaimResponse>();
    expect(body).toEqual({ credited: 0, newClaimableBalance: 0 });
  });

  it('claim empties claimable_balance and credits the wallet exactly once, even double-tapped', async () => {
    // Seed a real claimable balance: cross to Wood (0% on the crossing match itself), then earn
    // real rakeback on a second match at Wood's 1%.
    services.rewards.recordMatchSettlement(playerId, 100, 0.125, 'win');
    services.rewards.recordMatchSettlement(playerId, 1000, 0.1, 'win'); // rakeback = round(1) = 1

    const before = await app.inject({
      method: 'GET',
      url: '/rewards',
      headers: { authorization: `Bearer ${token}` },
    });
    const claimable = before.json<RewardsSnapshot>().claimableBalance;
    expect(claimable).toBeGreaterThan(0);

    const walletBefore = services.ledger.getBalance(playerId);

    // Fire two claim requests back-to-back (double-tap simulation) — better-sqlite3's
    // synchronous transactions mean these can never interleave, but assert the outcome anyway.
    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: '/rewards/claim', headers: { authorization: `Bearer ${token}` } }),
      app.inject({ method: 'POST', url: '/rewards/claim', headers: { authorization: `Bearer ${token}` } }),
    ]);

    const results = [first.json<RewardsClaimResponse>(), second.json<RewardsClaimResponse>()];
    const credited = results.map((r) => r.credited).sort((a, b) => b - a);
    expect(credited).toEqual([claimable, 0]); // exactly one of the two actually credited

    expect(services.ledger.getBalance(playerId)).toBe(walletBefore + claimable);
    const claimEntries = services.ledger.getEntries(playerId).filter((e) => e.type === 'REWARD_CLAIM');
    expect(claimEntries).toHaveLength(1);
    expect(claimEntries[0].amount).toBe(claimable);

    const after = await app.inject({
      method: 'GET',
      url: '/rewards',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.json<RewardsSnapshot>().claimableBalance).toBe(0);
  });

  it('POST /rewards/claim returns 401 without a bearer token', async () => {
    const res = await app.inject({ method: 'POST', url: '/rewards/claim' });
    expect(res.statusCode).toBe(401);
  });

  // AppOptions.onWrite (issue #378) — the durable-persistence hook that fires the GCS
  // snapshotter's debounced trigger() on non-settlement writes. rewards.claim() is
  // idempotent and returns credited: 0 on a no-op double-tap without touching the DB, so
  // the route only fires the hook when credited > 0 (see routes/rewards.ts).
  describe('onWrite hook (issue #378)', () => {
    it('fires onWrite when a real claim credits a positive amount', async () => {
      const onWrite = vi.fn();
      const db = new Database(':memory:');
      const services = createServices(db, []);
      const app = buildApp(services, [], { seedAdmin: false, onWrite });
      try {
        const reg = await app.inject({
          method: 'POST',
          url: '/auth/register',
          payload: { username: 'zola', password: 'pw' },
        });
        const { token: zolaToken, playerId: zolaId } = reg.json<{ token: string; playerId: string }>();
        // Two settlements, same as the "claim empties claimable_balance" test above: the
        // first crosses into Wood (0% rakeback on the crossing match itself), the second
        // earns real rakeback at Wood's 1% — a single settlement alone can land at 0.
        services.rewards.recordMatchSettlement(zolaId, 100, 0.125, 'win');
        services.rewards.recordMatchSettlement(zolaId, 1000, 0.1, 'win');
        onWrite.mockClear(); // ignore the registration's own onWrite call above

        const res = await app.inject({
          method: 'POST',
          url: '/rewards/claim',
          headers: { authorization: `Bearer ${zolaToken}` },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json<RewardsClaimResponse>().credited).toBeGreaterThan(0);
        expect(onWrite).toHaveBeenCalledTimes(1);
      } finally {
        await app.close();
      }
    });

    it('does NOT fire onWrite on a no-op claim (credited: 0)', async () => {
      const onWrite = vi.fn();
      const db = new Database(':memory:');
      const services = createServices(db, []);
      const app = buildApp(services, [], { seedAdmin: false, onWrite });
      try {
        const reg = await app.inject({
          method: 'POST',
          url: '/auth/register',
          payload: { username: 'yara', password: 'pw' },
        });
        const { token: yaraToken } = reg.json<{ token: string; playerId: string }>();
        onWrite.mockClear();

        const res = await app.inject({
          method: 'POST',
          url: '/rewards/claim',
          headers: { authorization: `Bearer ${yaraToken}` },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json<RewardsClaimResponse>().credited).toBe(0);
        expect(onWrite).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });
  });

  it('a guest session never accrues rewards — guest matchmaking is not wired to Rewards', async () => {
    const guestReg = await app.inject({ method: 'POST', url: '/auth/guest' });
    const guestBody = guestReg.json<{ token: string; playerId: string }>();

    // Even after a (hypothetical) real-ledger accrual under some OTHER account, the guest's own
    // GET /rewards must read a clean, all-zero snapshot — guest playerIds never touch the real
    // `rewards` table because guest matchmaking never wires onPlayerSettled.
    const res = await app.inject({
      method: 'GET',
      url: '/rewards',
      headers: { authorization: `Bearer ${guestBody.token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<RewardsSnapshot>().tier).toBe('Unranked');
  });
});
