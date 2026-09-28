import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { createServices, buildApp } from '../server.js';
import { GRANT_AMOUNT } from '@rapidclash/core';
import type { WalletResponse } from '@rapidclash/shared';

function makeApp() {
  const db = new Database(':memory:');
  const services = createServices(db, []);
  const app = buildApp(services, [], { seedAdmin: false });
  return { app, services };
}

describe('GET /wallet', () => {
  let app: FastifyInstance;
  let services: ReturnType<typeof makeApp>['services'];
  let token: string;
  let playerId: string;

  beforeEach(async () => {
    const made = makeApp();
    app = made.app;
    services = made.services;

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

  it('returns the starting balance derived from exactly one GRANT entry (S1)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/wallet',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const wallet = res.json<WalletResponse>();
    expect(wallet.balances.USD).toBe(GRANT_AMOUNT);
    // Ticket 2026-09-27#7 (D69): grant() now writes one GRANT per STARTING_BALANCE currency
    // (USD/SOL/USDT), so there are 3 GRANT entries, not 1 — isolate the USD-currency one to
    // keep testing this test's own real concern (S1's starting balance).
    const grants = wallet.entries.filter((e) => e.type === 'GRANT' && e.currency === 'USD');
    expect(grants).toHaveLength(1);
    expect(grants[0].amount).toBe(GRANT_AMOUNT);
  });

  it('balance is ledger-derived: it reflects a later credit, never a stored number', async () => {
    // Credit directly through the ledger, then confirm GET /wallet reflects it.
    services.ledger.adminCredit(playerId, 250, 'wallet-test-credit', 'USD');
    const res = await app.inject({
      method: 'GET',
      url: '/wallet',
      headers: { authorization: `Bearer ${token}` },
    });
    const wallet = res.json<WalletResponse>();
    expect(wallet.balances.USD).toBe(GRANT_AMOUNT + 250);
    expect(wallet.balances.USD).toBe(services.ledger.getBalance(playerId, 'USD'));
    expect(wallet.entries.some((e) => e.type === 'ADMIN_CREDIT' && e.amount === 250)).toBe(true);
  });

  it('returns 401 without a bearer token', async () => {
    const res = await app.inject({ method: 'GET', url: '/wallet' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with an invalid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/wallet',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
  });
});
