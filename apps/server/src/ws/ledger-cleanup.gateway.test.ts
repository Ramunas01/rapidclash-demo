import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { createServices, buildApp, type AppServices } from '../server.js';

// Ticket 2026-09-24#1: proves the gateway wiring around Ledger.cleanupSettled (whose own
// signature/age-cutoff/batching-yield logic is covered directly in packages/core/src/
// ledger.test.ts) — that a real backlog gets cleared once at server startup (not a separate
// manual step), that the independent hourly timer also runs (not just the startup pass), that
// a pass which deletes nothing correctly no-ops (no spurious snapshot trigger), and that a
// still-open escrow survives both the startup pass and a later timer tick.

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function rowCount(db: Database.Database, matchId: string): number {
  return (db.prepare(`SELECT COUNT(*) AS cnt FROM ledger_entry WHERE match_id = ?`).get(matchId) as { cnt: number }).cnt;
}

describe('WS gateway ledger cleanup wiring (ticket 2026-09-24#1)', () => {
  let app: FastifyInstance | undefined;
  let savedRetention: string | undefined;
  let savedInterval: string | undefined;

  beforeEach(() => {
    savedRetention = process.env.LEDGER_CLEANUP_RETENTION_DAYS;
    savedInterval = process.env.LEDGER_CLEANUP_INTERVAL_MS;
    // 0 days → the cutoff is "now", so any already-written row (necessarily created before this
    // instant) is immediately eligible — no need to backdate rows by hand in this gateway-level
    // test (packages/core/src/ledger.test.ts already covers the age-cutoff boundary itself
    // directly and precisely via backdating).
    process.env.LEDGER_CLEANUP_RETENTION_DAYS = '0';
  });

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    if (savedRetention === undefined) delete process.env.LEDGER_CLEANUP_RETENTION_DAYS; else process.env.LEDGER_CLEANUP_RETENTION_DAYS = savedRetention;
    if (savedInterval === undefined) delete process.env.LEDGER_CLEANUP_INTERVAL_MS; else process.env.LEDGER_CLEANUP_INTERVAL_MS = savedInterval;
  });

  async function boot(): Promise<{ services: AppServices; onWrite: ReturnType<typeof vi.fn> }> {
    const db = new Database(':memory:');
    const services = createServices(db, []);
    const onWrite = vi.fn();
    app = buildApp(services, [], { seedAdmin: false, onWrite });
    await app.listen({ port: 0, host: '127.0.0.1' });
    return { services, onWrite };
  }

  it('clears an existing backlog once at server startup — not a separate manual step — and triggers the snapshot hook', async () => {
    const db = new Database(':memory:');
    const services = createServices(db, []);
    services.ledger.grant('alice');
    services.ledger.escrow('alice', 'backlog-1', 50);
    services.ledger.refundEscrow('alice', 'backlog-1'); // already a fully-refunded, eligible group
    expect(rowCount(db, 'backlog-1')).toBe(2);

    const onWrite = vi.fn();
    app = buildApp(services, [], { seedAdmin: false, onWrite });
    await app.listen({ port: 0, host: '127.0.0.1' });

    // The startup pass is fire-and-forget (void runLedgerCleanup()) — give its setImmediate
    // yield(s) a moment to actually run.
    await delay(100);

    expect(rowCount(db, 'backlog-1')).toBe(0);
    expect(onWrite).toHaveBeenCalled();
    expect(services.ledger.getBalance('alice')).toBe(1000); // money-neutral: GRANT_AMOUNT unchanged
  });

  it('the independent hourly timer also runs — a group that becomes eligible AFTER startup still gets pruned', async () => {
    process.env.LEDGER_CLEANUP_INTERVAL_MS = '40'; // tiny so the test never waits the real 1hr
    const { services, onWrite } = await boot();
    await delay(60); // let the startup pass (a no-op — nothing eligible yet) settle first
    onWrite.mockClear();

    services.ledger.grant('bob');
    services.ledger.escrow('bob', 'post-startup-1', 25);
    services.ledger.refundEscrow('bob', 'post-startup-1');
    expect(rowCount(services.db, 'post-startup-1')).toBe(2);

    // Wait past at least one 40ms tick — the PERIODIC timer, not the one-shot startup pass,
    // must be what catches this.
    await delay(150);

    expect(rowCount(services.db, 'post-startup-1')).toBe(0);
    expect(onWrite).toHaveBeenCalled();
  });

  it('a still-open escrow (never refunded) survives both the startup pass and a later timer tick', async () => {
    process.env.LEDGER_CLEANUP_INTERVAL_MS = '40';
    const db = new Database(':memory:');
    const services = createServices(db, []);
    services.ledger.grant('carol');
    services.ledger.escrow('carol', 'still-open-1', 30); // resting, not yet expired/refunded

    const onWrite = vi.fn();
    app = buildApp(services, [], { seedAdmin: false, onWrite });
    await app.listen({ port: 0, host: '127.0.0.1' });

    await delay(150); // past the startup pass AND at least one periodic tick

    expect(rowCount(db, 'still-open-1')).toBe(1); // untouched
    expect(onWrite).not.toHaveBeenCalled(); // nothing was ever deleted — no spurious snapshot trigger
  });
});
