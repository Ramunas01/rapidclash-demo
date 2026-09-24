import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { createServices, buildApp } from '../server.js';

// Ticket 2026-09-24#4: proves the gateway wiring around Ledger.compactOldTransactions (whose own
// correctness — money-neutrality, the still-open-escrow safety guard, the whole-match-group
// eligibility rule, the OPENING_BALANCE fold-not-accumulate behavior — is covered directly in
// packages/core/src/ledger.test.ts). This file mirrors ledger-cleanup.gateway.test.ts's own
// shape: an independent timer, a startup pass that checks the real freelist (not just "it is
// startup"), the hourly tick gated on rowsDeleted > 0, and a still-open escrow left untouched
// with no spurious snapshot trigger.

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function rowsFor(db: Database.Database, accountId: string): { type: string }[] {
  return db.prepare(`SELECT type FROM ledger_entry WHERE account_id = ?`).all(accountId) as { type: string }[];
}
function freelistCount(db: Database.Database): number {
  return db.pragma('freelist_count', { simple: true }) as number;
}

describe('WS gateway transaction compaction wiring (ticket 2026-09-24#4)', () => {
  let app: FastifyInstance | undefined;
  let savedRetention: string | undefined;
  let savedInterval: string | undefined;

  beforeEach(() => {
    savedRetention = process.env.LEDGER_COMPACTION_RETENTION_DAYS;
    savedInterval = process.env.LEDGER_COMPACTION_INTERVAL_MS;
    // 0 days → cutoff is "now", so any already-written+settled row is immediately eligible — no
    // need to backdate by hand in this gateway-level test (ledger.test.ts already covers the
    // age-cutoff boundary directly and precisely via backdating).
    process.env.LEDGER_COMPACTION_RETENTION_DAYS = '0';
  });

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    if (savedRetention === undefined) delete process.env.LEDGER_COMPACTION_RETENTION_DAYS; else process.env.LEDGER_COMPACTION_RETENTION_DAYS = savedRetention;
    if (savedInterval === undefined) delete process.env.LEDGER_COMPACTION_INTERVAL_MS; else process.env.LEDGER_COMPACTION_INTERVAL_MS = savedInterval;
  });

  it('compacts an existing real completed match once at server startup — money-neutral, triggers the snapshot hook', async () => {
    const db = new Database(':memory:');
    const services = createServices(db, []);
    services.ledger.grant('alice');
    services.ledger.grant('bob');
    services.ledger.escrow('alice', 'startup-win-1', 100);
    services.ledger.escrow('bob', 'startup-win-1', 100);
    services.ledger.settle('startup-win-1', 'win', 'alice', 200, 0.1);
    const aliceBefore = services.ledger.getBalance('alice');
    const bobBefore = services.ledger.getBalance('bob');

    const onWrite = vi.fn();
    app = buildApp(services, [], { seedAdmin: false, onWrite });
    await app.listen({ port: 0, host: '127.0.0.1' });

    // The startup pass is fire-and-forget — give its setImmediate yield(s) a moment to run.
    await delay(100);

    expect(services.ledger.getBalance('alice')).toBe(aliceBefore); // money-neutral
    expect(services.ledger.getBalance('bob')).toBe(bobBefore);
    expect(rowsFor(db, 'alice').every((r) => r.type === 'OPENING_BALANCE')).toBe(true);
    expect(onWrite).toHaveBeenCalled();
  });

  it('the independent hourly timer also compacts history that becomes eligible AFTER startup', async () => {
    process.env.LEDGER_COMPACTION_INTERVAL_MS = '40'; // tiny so the test never waits the real 1hr
    const db = new Database(':memory:');
    const services = createServices(db, []);
    const onWrite = vi.fn();
    app = buildApp(services, [], { seedAdmin: false, onWrite });
    await app.listen({ port: 0, host: '127.0.0.1' });
    await delay(60); // let the startup pass (a no-op — nothing exists yet) settle first
    onWrite.mockClear();

    services.ledger.grant('carol');
    services.ledger.adminCredit('carol', 40, 'admin-post-startup');
    const before = services.ledger.getBalance('carol');

    // Wait past at least one 40ms tick — the PERIODIC timer, not the one-shot startup pass, must
    // be what catches this (retention=0 means it's eligible the instant it exists).
    await delay(150);

    expect(services.ledger.getBalance('carol')).toBe(before);
    expect(rowsFor(db, 'carol')).toHaveLength(1);
    expect(rowsFor(db, 'carol')[0].type).toBe('OPENING_BALANCE');
    expect(onWrite).toHaveBeenCalled();
  });

  it('a still-open escrow survives both the startup pass and a later timer tick — nothing eligible under normal (non-zero) retention, no spurious VACUUM/onWrite', async () => {
    // A real, positive retention window here (not the describe block's own 0-day override) — the
    // point of this test is "nothing is old enough yet," including dave's own GRANT, isolating
    // the still-open escrow as the only thing under scrutiny.
    process.env.LEDGER_COMPACTION_RETENTION_DAYS = '10';
    process.env.LEDGER_COMPACTION_INTERVAL_MS = '40';
    const db = new Database(':memory:');
    const services = createServices(db, []);
    services.ledger.grant('dave');
    services.ledger.escrow('dave', 'still-open-1', 30); // resting, unsettled

    const onWrite = vi.fn();
    app = buildApp(services, [], { seedAdmin: false, onWrite });
    await app.listen({ port: 0, host: '127.0.0.1' });

    await delay(150); // past the startup pass AND at least one periodic tick

    expect(services.ledger.hasOpenEscrow('dave')).toBe(true); // the escrow row itself must survive
    expect(services.ledger.getOpenEscrowMatchIds('dave')).toContain('still-open-1');
    expect(onWrite).not.toHaveBeenCalled(); // nothing was old enough to compact — no spurious trigger
  });

  it("a still-open escrow's own row survives even when it IS old enough by age alone (retention=0) — only its lack of a settlement row protects it, not its age", async () => {
    const db = new Database(':memory:');
    const services = createServices(db, []);
    services.ledger.grant('erin');
    services.ledger.escrow('erin', 'still-open-2', 30); // resting, unsettled — "old enough" (retention=0) but never resolved

    app = buildApp(services, [], { seedAdmin: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    await delay(100);

    // Erin's own GRANT (a standalone row, no match-grouping concern) legitimately compacts under
    // retention=0 — expected, unrelated to the escrow's own safety. The escrow itself is the
    // thing under test here.
    expect(services.ledger.hasOpenEscrow('erin')).toBe(true);
    expect(services.ledger.getOpenEscrowMatchIds('erin')).toContain('still-open-2');
  });

  it('the startup pass reclaims real freelist bloat left over from a prior compaction that never VACUUMed', async () => {
    const db = new Database(':memory:');
    const services = createServices(db, []);
    // Simulate pre-existing dead space via raw SQL, bypassing compactOldTransactions entirely —
    // unambiguously "space freed before this fix existed" (same technique as the D48/#3 test).
    const insertMany = db.prepare(
      `INSERT INTO ledger_entry (id, account_id, match_id, type, amount, idempotency_key, created_at)
       VALUES (?, 'bloat-acct', NULL, 'ADMIN_CREDIT', 1, ?, ?)`,
    );
    const now = new Date().toISOString();
    for (let i = 0; i < 2000; i++) insertMany.run(`pre-${i}`, `pre-key-${i}`, now);
    db.prepare(`DELETE FROM ledger_entry WHERE account_id = 'bloat-acct'`).run();
    expect(freelistCount(db)).toBeGreaterThan(0); // real, unreclaimed dead space

    const onWrite = vi.fn();
    app = buildApp(services, [], { seedAdmin: false, onWrite });
    await app.listen({ port: 0, host: '127.0.0.1' });
    await delay(100);

    expect(freelistCount(db)).toBe(0); // VACUUM ran and reclaimed it — even though this pass compacted 0 rows
    expect(onWrite).toHaveBeenCalled();
  });
});
