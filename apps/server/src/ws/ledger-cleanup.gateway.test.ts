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
//
// Ticket 2026-09-24#3: proves VACUUM's own two-mode gating — the startup pass checks the REAL
// `PRAGMA freelist_count` (not just "it is startup") so it reclaims dead space genuinely left
// over from BEFORE this fix ever shipped, while a truly clean boot (nothing ever deleted, the
// common case for a fresh test DB or a steady-state redeploy after this fix has already run
// once) costs nothing; the hourly timer's own pass stays gated on rowsDeleted > 0 only. Verified
// via PRAGMA freelist_count directly — SQLite's own ground truth for "did a VACUUM actually
// reclaim space," not just "did some function run."

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

  it('a still-open escrow (never refunded) survives both the startup pass and a later timer tick — a genuinely clean DB never VACUUMs/triggers onWrite (ticket #3: checks the real freelist, not just "it is startup")', async () => {
    process.env.LEDGER_CLEANUP_INTERVAL_MS = '40';
    const db = new Database(':memory:');
    const services = createServices(db, []);
    services.ledger.grant('carol');
    services.ledger.escrow('carol', 'still-open-1', 30); // resting, not yet expired/refunded — never deleted, so freelist stays empty

    const onWrite = vi.fn();
    app = buildApp(services, [], { seedAdmin: false, onWrite });
    await app.listen({ port: 0, host: '127.0.0.1' });

    await delay(150); // past the startup pass AND at least one periodic tick

    expect(rowCount(db, 'still-open-1')).toBe(1); // untouched — the prune rule itself is unaffected
    expect(onWrite).not.toHaveBeenCalled(); // nothing was ever deleted anywhere — no freelist bloat to reclaim, no spurious trigger
  });
});

describe('WS gateway ledger cleanup: VACUUM (ticket 2026-09-24#3)', () => {
  let app: FastifyInstance | undefined;
  let savedRetention: string | undefined;
  let savedInterval: string | undefined;

  beforeEach(() => {
    savedRetention = process.env.LEDGER_CLEANUP_RETENTION_DAYS;
    savedInterval = process.env.LEDGER_CLEANUP_INTERVAL_MS;
    process.env.LEDGER_CLEANUP_RETENTION_DAYS = '0';
  });

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    if (savedRetention === undefined) delete process.env.LEDGER_CLEANUP_RETENTION_DAYS; else process.env.LEDGER_CLEANUP_RETENTION_DAYS = savedRetention;
    if (savedInterval === undefined) delete process.env.LEDGER_CLEANUP_INTERVAL_MS; else process.env.LEDGER_CLEANUP_INTERVAL_MS = savedInterval;
  });

  function freelistCount(db: Database.Database): number {
    return db.pragma('freelist_count', { simple: true }) as number;
  }

  it('the startup pass VACUUMs and reclaims dead space left over from BEFORE this fix ever shipped, purely by checking the real freelist — even though THIS boot deletes nothing itself', async () => {
    const db = new Database(':memory:');
    const services = createServices(db, []);
    // Simulate the exact real-world state this ticket targets: a prior cleanup pass already
    // deleted rows (freeing pages), but nothing ever VACUUMed — done here via raw SQL, bypassing
    // cleanupSettled entirely, so it's unambiguously "space freed before this fix existed."
    const insertMany = db.prepare(
      `INSERT INTO ledger_entry (id, account_id, match_id, type, amount, idempotency_key, created_at)
       VALUES (?, 'bloat-acct', 'pre-existing-bloat', 'BET_ESCROW', -1, ?, ?)`,
    );
    const now = new Date().toISOString();
    for (let i = 0; i < 2000; i++) insertMany.run(`pre-${i}`, `pre-key-${i}`, now);
    db.prepare(`DELETE FROM ledger_entry WHERE match_id = 'pre-existing-bloat'`).run();
    expect(freelistCount(db)).toBeGreaterThan(0); // real, unreclaimed dead space — the exact bug

    const onWrite = vi.fn();
    app = buildApp(services, [], { seedAdmin: false, onWrite });
    await app.listen({ port: 0, host: '127.0.0.1' });
    await delay(100);

    expect(freelistCount(db)).toBe(0); // VACUUM ran and reclaimed it — even though this pass pruned 0 rows
    expect(onWrite).toHaveBeenCalled();
  });

  it('the hourly timer VACUUMs (and reclaims space) only on a tick that actually deleted rows', async () => {
    process.env.LEDGER_CLEANUP_INTERVAL_MS = '40';
    const db = new Database(':memory:');
    const services = createServices(db, []);
    const onWrite = vi.fn();
    app = buildApp(services, [], { seedAdmin: false, onWrite });
    await app.listen({ port: 0, host: '127.0.0.1' });
    await delay(60); // let the (no-op-but-still-VACUUMs-once) startup pass settle
    onWrite.mockClear();

    services.ledger.grant('dave');
    for (let i = 0; i < 200; i++) {
      services.ledger.escrow('dave', `hourly-bloat-${i}`, 1);
      services.ledger.refundEscrow('dave', `hourly-bloat-${i}`);
    }
    expect(rowCount(services.db, 'hourly-bloat-0')).toBe(2); // still present — not yet swept

    await delay(150); // past at least one periodic tick — DELETE + this tick's own VACUUM both run

    expect(rowCount(services.db, 'hourly-bloat-0')).toBe(0); // the rows themselves were pruned
    expect(freelistCount(services.db)).toBe(0); // AND this tick's own VACUUM reclaimed the space
    expect(onWrite).toHaveBeenCalled();
  });
});

// Ticket 2026-09-24#5: dbstat on the live snapshot showed the meaningless-pair category is the
// correct, working steady-state floor for the ORIGINAL 2-day retention against the bot-crowd's
// actual posting rate, not leftover bloat — shortened the default to 6 hours (0.25 days). The
// env var's own parsing was `parseInt`, which truncates a fractional-day value like "0.25" to 0
// — a silent, far-more-aggressive-than-intended zero-retention bug this fix (parseFloat) closes.
describe('WS gateway ledger cleanup retention parsing (ticket 2026-09-24#5)', () => {
  let app: FastifyInstance | undefined;
  let savedRetention: string | undefined;

  beforeEach(() => {
    savedRetention = process.env.LEDGER_CLEANUP_RETENTION_DAYS;
  });

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    if (savedRetention === undefined) delete process.env.LEDGER_CLEANUP_RETENTION_DAYS; else process.env.LEDGER_CLEANUP_RETENTION_DAYS = savedRetention;
  });

  it('a fractional-day env value (e.g. "0.25") is honored, not truncated to zero — a group younger than 6h is NOT touched, but IS eligible once older', async () => {
    process.env.LEDGER_CLEANUP_RETENTION_DAYS = '0.25'; // 6 hours
    const db = new Database(':memory:');
    const services = createServices(db, []);
    services.ledger.grant('alice');
    services.ledger.escrow('alice', 'fresh-1', 50);
    services.ledger.refundEscrow('alice', 'fresh-1'); // created_at = now — well under 6h old

    app = buildApp(services, [], { seedAdmin: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    await delay(100); // past the startup pass

    // If parseInt("0.25", 10) === 0 had silently won (the bug this fix closes), the cutoff would
    // be "now" and this fresh group would be wrongly deleted immediately.
    expect(rowCount(db, 'fresh-1')).toBe(2);

    // Same group, backdated 7h (older than the 6h window) — a SEPARATE server instance (fresh
    // startup pass, retention unchanged) now correctly prunes it.
    const oldIso = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    db.prepare(`UPDATE ledger_entry SET created_at = ? WHERE match_id = 'fresh-1'`).run(oldIso);
    await app.close();
    app = buildApp(services, [], { seedAdmin: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    await delay(100);

    expect(rowCount(db, 'fresh-1')).toBe(0);
  });

  it('the default retention is now 6 hours (0.25 days), not the old 2 days — a group aged 12h is eligible, matching 6h but not the old 2-day window', async () => {
    const db = new Database(':memory:');
    const services = createServices(db, []);
    services.ledger.grant('bob');
    services.ledger.escrow('bob', 'default-window-1', 50);
    services.ledger.refundEscrow('bob', 'default-window-1');
    const oldIso = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(); // 12h old
    db.prepare(`UPDATE ledger_entry SET created_at = ? WHERE match_id = 'default-window-1'`).run(oldIso);

    app = buildApp(services, [], { seedAdmin: false }); // no env var set — exercises the default
    await app.listen({ port: 0, host: '127.0.0.1' });
    await delay(100);

    expect(rowCount(db, 'default-window-1')).toBe(0); // 12h > 6h default — eligible now
  });
});
