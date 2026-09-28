import { describe, beforeEach, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { CURRENCIES, STARTING_BALANCE } from '@rapidclash/shared';
import { createLedger, GRANT_AMOUNT, PLATFORM_ACCOUNT } from './ledger.js';

describe('ledger', () => {
  let db: Database.Database;
  let ledger: ReturnType<typeof createLedger>;

  beforeEach(() => {
    db = new Database(':memory:');
    ledger = createLedger(db);
  });

  it('starting balance equals one GRANT', () => {
    ledger.grant('alice');
    expect(ledger.getBalance('alice', 'USD')).toBe(GRANT_AMOUNT);
  });

  it('unknown account has zero balance', () => {
    expect(ledger.getBalance('nobody', 'USD')).toBe(0);
  });

  it('escrow reduces balance by the staked amount', () => {
    ledger.grant('alice');
    ledger.escrow('alice', 'match-1', 100, 'USD');
    expect(ledger.getBalance('alice', 'USD')).toBe(GRANT_AMOUNT - 100);
  });

  it('escrowing more than balance throws', () => {
    ledger.grant('alice');
    expect(() => ledger.escrow('alice', 'match-1', GRANT_AMOUNT + 1, 'USD')).toThrow();
  });

  it('escrowing with zero amount throws', () => {
    ledger.grant('alice');
    expect(() => ledger.escrow('alice', 'match-1', 0, 'USD')).toThrow();
  });

  it('win settlement: sum across all accounts is zero (money conserved)', () => {
    ledger.grant('alice');
    ledger.grant('bob');
    ledger.escrow('alice', 'match-win', 100, 'USD');
    ledger.escrow('bob', 'match-win', 100, 'USD');

    // pot = 200, feeRate = 10% → rake = 20, winner gets 180
    ledger.settle('match-win', 'win', 'alice', 200, 0.1, 'USD');

    const alice = ledger.getBalance('alice', 'USD');
    const bob = ledger.getBalance('bob', 'USD');
    const platform = ledger.getBalance(PLATFORM_ACCOUNT, 'USD');

    // alice: 900 (after escrow) + 180 (win) = 1080
    // bob:   900 (after escrow, no settlement credit)
    // platform: 20 (rake)
    expect(alice).toBe(1080);
    expect(bob).toBe(900);
    expect(platform).toBe(20);
    // Conservation: total equals sum of all grants
    expect(alice + bob + platform).toBe(2 * GRANT_AMOUNT);
  });

  it('draw settlement: each player refunded, no rake, sum is zero', () => {
    ledger.grant('alice');
    ledger.grant('bob');
    ledger.escrow('alice', 'match-draw', 150, 'USD');
    ledger.escrow('bob', 'match-draw', 150, 'USD');

    ledger.settle('match-draw', 'draw', undefined, 300, 0.1);

    const alice = ledger.getBalance('alice', 'USD');
    const bob = ledger.getBalance('bob', 'USD');
    const platform = ledger.getBalance(PLATFORM_ACCOUNT, 'USD');

    expect(alice).toBe(GRANT_AMOUNT);
    expect(bob).toBe(GRANT_AMOUNT);
    expect(platform).toBe(0);
    expect(alice + bob + platform).toBe(2 * GRANT_AMOUNT);
  });

  it('void settlement: each player refunded in full, no rake', () => {
    ledger.grant('alice');
    ledger.grant('bob');
    ledger.escrow('alice', 'match-void', 200, 'USD');
    ledger.escrow('bob', 'match-void', 200, 'USD');

    ledger.settle('match-void', 'void', undefined, 400, 0.05);

    expect(ledger.getBalance('alice', 'USD')).toBe(GRANT_AMOUNT);
    expect(ledger.getBalance('bob', 'USD')).toBe(GRANT_AMOUNT);
    expect(ledger.getBalance(PLATFORM_ACCOUNT, 'USD')).toBe(0);
  });

  it('settle is idempotent: replaying the same match_id is a no-op', () => {
    ledger.grant('alice');
    ledger.grant('bob');
    ledger.escrow('alice', 'match-idem', 100, 'USD');
    ledger.escrow('bob', 'match-idem', 100, 'USD');

    ledger.settle('match-idem', 'win', 'alice', 200, 0.1, 'USD');
    const balanceAfterFirst = ledger.getBalance('alice', 'USD');
    const entriesAfterFirst = ledger.getEntries('alice').length;

    ledger.settle('match-idem', 'win', 'alice', 200, 0.1, 'USD');

    expect(ledger.getBalance('alice', 'USD')).toBe(balanceAfterFirst);
    expect(ledger.getEntries('alice').length).toBe(entriesAfterFirst);
  });

  it('escrow is idempotent: double-tap escrows once', () => {
    ledger.grant('alice');
    ledger.escrow('alice', 'match-esc-idem', 100, 'USD');
    ledger.escrow('alice', 'match-esc-idem', 100, 'USD'); // same key — no-op
    expect(ledger.getBalance('alice', 'USD')).toBe(GRANT_AMOUNT - 100);
  });

  it('getEntries returns all entries for an account in order', () => {
    ledger.grant('alice');
    ledger.escrow('alice', 'match-entries', 50, 'USD');
    // Ticket 2026-09-27#7 (D69): grant() now writes one GRANT per STARTING_BALANCE currency
    // (USD/SOL/USDT today) — getEntries returns every currency's rows, in insertion order, so
    // there are 4 total here (3 GRANT + 1 BET_ESCROW), not 2. Scoped to the USD-currency rows
    // specifically to keep testing this test's own real concern (grant→escrow ordering) rather
    // than the exact multi-currency row count, which is covered by its own dedicated test below.
    const entries = ledger.getEntries('alice');
    expect(entries).toHaveLength(4);
    const usdEntries = entries.filter((e) => e.currency === 'USD');
    expect(usdEntries).toHaveLength(2);
    expect(usdEntries[0].type).toBe('GRANT');
    expect(usdEntries[1].type).toBe('BET_ESCROW');
    expect(usdEntries[1].matchId).toBe('match-entries');
  });

  it('grant is idempotent: same account_id grants once', () => {
    ledger.grant('alice');
    ledger.grant('alice'); // duplicate — ignored
    expect(ledger.getBalance('alice', 'USD')).toBe(GRANT_AMOUNT);
  });

  describe('multi-currency (ticket 2026-09-27#7, D69)', () => {
    it('grant seeds every STARTING_BALANCE currency and leaves the rest at zero', () => {
      ledger.grant('alice');
      for (const currency of CURRENCIES) {
        expect(ledger.getBalance('alice', currency)).toBe(STARTING_BALANCE[currency] ?? 0);
      }
      // Sanity: this ticket's own starting balances, spelled out explicitly.
      expect(ledger.getBalance('alice', 'USD')).toBe(1000);
      expect(ledger.getBalance('alice', 'SOL')).toBe(1642);
      expect(ledger.getBalance('alice', 'USDT')).toBe(837);
      expect(ledger.getBalance('alice', 'BTC')).toBe(0);
    });

    it('escrowing one currency never touches another currency\'s bucket', () => {
      ledger.grant('alice');
      ledger.escrow('alice', 'match-sol', 500, 'SOL');
      expect(ledger.getBalance('alice', 'SOL')).toBe(1642 - 500);
      expect(ledger.getBalance('alice', 'USD')).toBe(1000);
      expect(ledger.getBalance('alice', 'USDT')).toBe(837);
    });

    it('escrowing more than a currency\'s own balance throws, even if another currency has plenty', () => {
      ledger.grant('alice');
      // USDT (837) can't cover a 900 stake, even though USD (1000) could.
      expect(() => ledger.escrow('alice', 'match-usdt', 900, 'USDT')).toThrow();
    });

    it('settle credits the winner\'s own currency bucket only, two players on different currencies', () => {
      ledger.grant('alice');
      ledger.grant('bob');
      ledger.escrow('alice', 'match-xcur', 200, 'SOL');
      ledger.escrow('bob', 'match-xcur', 200, 'USDT');

      ledger.settle('match-xcur', 'win', 'alice', 400, 0.1, 'SOL');

      // alice: 1642 - 200 (escrow) + 360 (win, 400 pot - 10% rake) = 1802, all in SOL.
      expect(ledger.getBalance('alice', 'SOL')).toBe(1642 - 200 + 360);
      expect(ledger.getBalance('alice', 'USDT')).toBe(837); // untouched
      // bob's USDT stake is gone (lost), his SOL/USD buckets are untouched.
      expect(ledger.getBalance('bob', 'USDT')).toBe(837 - 200);
      expect(ledger.getBalance('bob', 'SOL')).toBe(1642);
      expect(ledger.getBalance(PLATFORM_ACCOUNT, 'SOL')).toBe(40); // rake, in SOL
    });

    it('draw settlement refunds each player into their OWN currency, no reconciliation needed', () => {
      ledger.grant('alice');
      ledger.grant('bob');
      ledger.escrow('alice', 'match-xcur-draw', 300, 'SOL');
      ledger.escrow('bob', 'match-xcur-draw', 300, 'USD');

      ledger.settle('match-xcur-draw', 'draw', undefined, 600, 0.1);

      expect(ledger.getBalance('alice', 'SOL')).toBe(1642); // full refund, back to starting
      expect(ledger.getBalance('bob', 'USD')).toBe(1000); // full refund, back to starting
    });

    it('refundEscrow returns money to the currency it was escrowed from, without being told which', () => {
      ledger.grant('alice');
      ledger.escrow('alice', 'match-refund', 100, 'USDT');
      ledger.refundEscrow('alice', 'match-refund');
      expect(ledger.getBalance('alice', 'USDT')).toBe(837); // back to starting
      expect(ledger.getBalance('alice', 'USD')).toBe(1000); // untouched
    });

    it('compactOldTransactions folds each currency\'s old rows into its own checkpoint, never mixing currencies', async () => {
      ledger.grant('alice');
      ledger.grant('bob');
      ledger.escrow('alice', 'match-compact-xcur', 400, 'SOL');
      ledger.escrow('bob', 'match-compact-xcur', 400, 'SOL');
      ledger.settle('match-compact-xcur', 'win', 'alice', 800, 0.1, 'SOL');
      const iso = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare(`UPDATE ledger_entry SET created_at = ? WHERE account_id = 'alice' AND match_id IS NULL`).run(iso);
      db.prepare(`UPDATE ledger_entry SET created_at = ? WHERE match_id = 'match-compact-xcur'`).run(iso);

      const before = {
        USD: ledger.getBalance('alice', 'USD'),
        SOL: ledger.getBalance('alice', 'SOL'),
        USDT: ledger.getBalance('alice', 'USDT'),
      };

      await ledger.compactOldTransactions(10);

      const rows = db
        .prepare(`SELECT amount, currency FROM ledger_entry WHERE account_id = ? ORDER BY rowid`)
        .all('alice') as { amount: number; currency: string }[];
      // One checkpoint per currency — 3 rows, none mixing SOL and USD/USDT together.
      expect(rows).toHaveLength(3);
      expect(rows.find((r) => r.currency === 'USD')!.amount).toBe(before.USD);
      expect(rows.find((r) => r.currency === 'SOL')!.amount).toBe(before.SOL);
      expect(rows.find((r) => r.currency === 'USDT')!.amount).toBe(before.USDT);
      // Balances byte-identical before/after, per currency.
      expect(ledger.getBalance('alice', 'USD')).toBe(before.USD);
      expect(ledger.getBalance('alice', 'SOL')).toBe(before.SOL);
      expect(ledger.getBalance('alice', 'USDT')).toBe(before.USDT);
    });
  });

  describe('hasOpenEscrow (soft-reset money-safety guard)', () => {
    it('is false for an account with no escrows', () => {
      ledger.grant('alice');
      expect(ledger.hasOpenEscrow('alice')).toBe(false);
    });

    it('is true while a match is escrowed but unsettled (live match)', () => {
      ledger.grant('alice');
      ledger.grant('bob');
      ledger.escrow('alice', 'live-match', 100, 'USD');
      ledger.escrow('bob', 'live-match', 100, 'USD');
      expect(ledger.hasOpenEscrow('alice')).toBe(true);
      expect(ledger.hasOpenEscrow('bob')).toBe(true);
    });

    it('is true for a resting open challenge (escrowed, never matched/settled)', () => {
      ledger.grant('alice');
      ledger.escrow('alice', 'resting-challenge', 100, 'USD');
      expect(ledger.hasOpenEscrow('alice')).toBe(true);
    });

    it('is false again once the match settles as a win (winner AND loser)', () => {
      ledger.grant('alice');
      ledger.grant('bob');
      ledger.escrow('alice', 'm-win', 100, 'USD');
      ledger.escrow('bob', 'm-win', 100, 'USD');
      ledger.settle('m-win', 'win', 'alice', 200, 0.1, 'USD');
      expect(ledger.hasOpenEscrow('alice')).toBe(false); // winner: SETTLE_WIN exists
      expect(ledger.hasOpenEscrow('bob')).toBe(false); // loser: match has SETTLE_WIN/RAKE
    });

    it('is false again once the match settles as a draw (both refunded)', () => {
      ledger.grant('alice');
      ledger.grant('bob');
      ledger.escrow('alice', 'm-draw', 100, 'USD');
      ledger.escrow('bob', 'm-draw', 100, 'USD');
      ledger.settle('m-draw', 'draw', undefined, 200, 0.1);
      expect(ledger.hasOpenEscrow('alice')).toBe(false);
      expect(ledger.hasOpenEscrow('bob')).toBe(false);
    });

    it('an unsettled escrow on ONE match keeps the guard true despite other settled matches', () => {
      ledger.grant('alice');
      ledger.grant('bob');
      ledger.escrow('alice', 'm-done', 100, 'USD');
      ledger.escrow('bob', 'm-done', 100, 'USD');
      ledger.settle('m-done', 'win', 'bob', 200, 0.1, 'USD');
      ledger.escrow('alice', 'm-open', 100, 'USD'); // still in flight
      expect(ledger.hasOpenEscrow('alice')).toBe(true);
    });
  });

  // Ticket 2026-09-24#1: prunes ledger_entry rows for a fully-refunded match_id group, old
  // enough per the retention window. Root cause: bot resters' own post→expire→refund→repost
  // cycle (ADR-010, working as designed) drove the live DB to 371MB, almost entirely this one
  // signature. Money-neutral by construction (a BET_ESCROW and its matching SETTLE_REFUND
  // always sum to zero) — verified directly via getBalance, not assumed.
  describe('cleanupSettled', () => {
    /** Backdates every ledger_entry row for matchId by `days`, so it clears the retention
     *  cutoff without needing a real clock — writeEntry always stamps "now". */
    function backdate(matchId: string, days: number): void {
      const iso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      db.prepare(`UPDATE ledger_entry SET created_at = ? WHERE match_id = ?`).run(iso, matchId);
    }
    function rowCount(matchId: string): number {
      return (db.prepare(`SELECT COUNT(*) AS cnt FROM ledger_entry WHERE match_id = ?`).get(matchId) as { cnt: number }).cnt;
    }

    it('deletes an old resting-challenge-expiry refund (BET_ESCROW + SETTLE_REFUND, one account)', async () => {
      ledger.grant('alice');
      ledger.escrow('alice', 'expired-1', 50, 'USD');
      ledger.refundEscrow('alice', 'expired-1');
      backdate('expired-1', 5);

      const result = await ledger.cleanupSettled(2);
      expect(result).toEqual({ matchesDeleted: 1, rowsDeleted: 2 });
      expect(rowCount('expired-1')).toBe(0);
    });

    it('deletes an old draw (BET_ESCROW×2 + SETTLE_REFUND×2, two accounts)', async () => {
      ledger.grant('alice');
      ledger.grant('bob');
      ledger.escrow('alice', 'old-draw', 100, 'USD');
      ledger.escrow('bob', 'old-draw', 100, 'USD');
      ledger.settle('old-draw', 'draw', undefined, 200, 0.1);
      backdate('old-draw', 5);

      const result = await ledger.cleanupSettled(2);
      expect(result).toEqual({ matchesDeleted: 1, rowsDeleted: 4 });
      expect(rowCount('old-draw')).toBe(0);
    });

    it('leaves a still-open resting challenge untouched (BET_ESCROW only, no refund yet — not expired)', async () => {
      ledger.grant('alice');
      ledger.escrow('alice', 'still-resting', 50, 'USD');
      backdate('still-resting', 5); // old, but never refunded — must survive

      const result = await ledger.cleanupSettled(2);
      expect(result).toEqual({ matchesDeleted: 0, rowsDeleted: 0 });
      expect(rowCount('still-resting')).toBe(1);
    });

    it('leaves a still-open live match untouched (BET_ESCROW×2, unsettled)', async () => {
      ledger.grant('alice');
      ledger.grant('bob');
      ledger.escrow('alice', 'live-match', 100, 'USD');
      ledger.escrow('bob', 'live-match', 100, 'USD');
      backdate('live-match', 5);

      const result = await ledger.cleanupSettled(2);
      expect(result).toEqual({ matchesDeleted: 0, rowsDeleted: 0 });
      expect(rowCount('live-match')).toBe(2);
    });

    it('leaves a won match untouched (SETTLE_WIN/RAKE present — never eligible, regardless of age)', async () => {
      ledger.grant('alice');
      ledger.grant('bob');
      ledger.escrow('alice', 'old-win', 100, 'USD');
      ledger.escrow('bob', 'old-win', 100, 'USD');
      ledger.settle('old-win', 'win', 'alice', 200, 0.1, 'USD');
      backdate('old-win', 5);

      const result = await ledger.cleanupSettled(2);
      expect(result).toEqual({ matchesDeleted: 0, rowsDeleted: 0 });
      expect(rowCount('old-win')).toBe(4); // 2 escrows + SETTLE_WIN + RAKE
    });

    it('age cutoff: an otherwise-eligible refund NEWER than the retention window is left alone', async () => {
      ledger.grant('alice');
      ledger.escrow('alice', 'recent-refund', 50, 'USD');
      ledger.refundEscrow('alice', 'recent-refund'); // created_at = now, no backdating

      const result = await ledger.cleanupSettled(2);
      expect(result).toEqual({ matchesDeleted: 0, rowsDeleted: 0 });
      expect(rowCount('recent-refund')).toBe(2);
    });

    it('is money-neutral: getBalance for the pruned account is unchanged before/after cleanup', async () => {
      ledger.grant('alice');
      ledger.escrow('alice', 'neutral-check', 50, 'USD');
      ledger.refundEscrow('alice', 'neutral-check');
      backdate('neutral-check', 5);
      const before = ledger.getBalance('alice', 'USD');

      await ledger.cleanupSettled(2);

      expect(ledger.getBalance('alice', 'USD')).toBe(before);
      expect(ledger.getBalance('alice', 'USD')).toBe(GRANT_AMOUNT); // escrow(-50) + refund(+50) = net 0
    });

    it('nothing eligible: no-ops cleanly, no DELETE ever runs', async () => {
      ledger.grant('alice');
      const result = await ledger.cleanupSettled(2);
      expect(result).toEqual({ matchesDeleted: 0, rowsDeleted: 0 });
    });

    it('batches genuinely yield the event loop between chunks — not one unbounded transaction', async () => {
      // 3 eligible match groups, batchSize 1 → 3 chunks, 2 yields between them.
      for (const m of ['b1', 'b2', 'b3']) {
        ledger.grant(`acct-${m}`);
        ledger.escrow(`acct-${m}`, m, 10, 'USD');
        ledger.refundEscrow(`acct-${m}`, m);
        backdate(m, 5);
      }
      const immediateSpy = vi.spyOn(global, 'setImmediate');
      try {
        const result = await ledger.cleanupSettled(2, 1);
        expect(result).toEqual({ matchesDeleted: 3, rowsDeleted: 6 });
        expect(immediateSpy).toHaveBeenCalledTimes(2); // yields BETWEEN chunks, not after the last
      } finally {
        immediateSpy.mockRestore();
      }
    });

    it('a single chunk (backlog fits in one batch) never yields at all', async () => {
      ledger.grant('alice');
      ledger.escrow('alice', 'one-chunk', 50, 'USD');
      ledger.refundEscrow('alice', 'one-chunk');
      backdate('one-chunk', 5);
      const immediateSpy = vi.spyOn(global, 'setImmediate');
      try {
        await ledger.cleanupSettled(2, 500);
        expect(immediateSpy).not.toHaveBeenCalled();
      } finally {
        immediateSpy.mockRestore();
      }
    });
  });

  // Ticket 2026-09-24#4: unlike cleanupSettled (only ever deletes zero-sum BET_ESCROW/
  // SETTLE_REFUND pairs), this compacts REAL, non-zero-sum transaction history — a GRANT,
  // SETTLE_WIN, RAKE, ADMIN_CREDIT, REWARD_CLAIM, or a prior OPENING_BALANCE itself — into one
  // checkpoint per account. getBalance() is a bare SUM over every row an account has ever had,
  // so correctness hinges entirely on the checkpoint's own amount being exact, and on never
  // compacting away one side of a match's rows while leaving the other (which would either hide
  // a still-open escrow from hasOpenEscrow forever, or make an already-settled match look open
  // again).
  describe('compactOldTransactions', () => {
    function backdateMatch(matchId: string, days: number): void {
      const iso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      db.prepare(`UPDATE ledger_entry SET created_at = ? WHERE match_id = ?`).run(iso, matchId);
    }
    function backdateStandalone(accountId: string, days: number): void {
      const iso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      db.prepare(`UPDATE ledger_entry SET created_at = ? WHERE account_id = ? AND match_id IS NULL`).run(iso, accountId);
    }
    function rowsFor(accountId: string): { type: string; amount: number; match_id: string | null; currency: string }[] {
      return db.prepare(`SELECT type, amount, match_id, currency FROM ledger_entry WHERE account_id = ? ORDER BY rowid`).all(accountId) as { type: string; amount: number; match_id: string | null; currency: string }[];
    }

    it('compacts a real completed match (win + rake) into OPENING_BALANCE — every account\'s getBalance() is byte-identical before/after', async () => {
      ledger.grant('alice');
      ledger.grant('bob');
      ledger.escrow('alice', 'real-win-1', 100, 'USD');
      ledger.escrow('bob', 'real-win-1', 100, 'USD');
      ledger.settle('real-win-1', 'win', 'alice', 200, 0.1, 'USD'); // alice +180 net, PLATFORM +20
      backdateMatch('real-win-1', 15);
      backdateStandalone('alice', 15);
      backdateStandalone('bob', 15);

      const aliceBefore = ledger.getBalance('alice', 'USD');
      const bobBefore = ledger.getBalance('bob', 'USD');
      const platformBefore = ledger.getBalance(PLATFORM_ACCOUNT, 'USD');

      const result = await ledger.compactOldTransactions(10);
      expect(result.accountsCompacted).toBeGreaterThan(0);

      expect(ledger.getBalance('alice', 'USD')).toBe(aliceBefore);
      expect(ledger.getBalance('bob', 'USD')).toBe(bobBefore);
      expect(ledger.getBalance(PLATFORM_ACCOUNT, 'USD')).toBe(platformBefore);

      // Ticket 2026-09-27#7 (D69): alice's whole history folds to ONE ROW PER CURRENCY, not one
      // row overall — grant() seeded USD/SOL/USDT, and backdateStandalone backdates ALL of her
      // standalone rows (not just USD's), so the SOL/USDT starting grants are ALSO old enough to
      // compact into their own (untouched-amount) checkpoints this same pass. 3 total: the real
      // USD activity (GRANT+BET_ESCROW+SETTLE_WIN) folds into one USD OPENING_BALANCE matching
      // aliceBefore exactly; SOL/USDT each fold their own single unchanged GRANT into their own
      // checkpoint.
      const aliceRows = rowsFor('alice');
      expect(aliceRows).toHaveLength(3);
      expect(aliceRows.every((r) => r.type === 'OPENING_BALANCE')).toBe(true);
      const usdRow = aliceRows.find((r) => r.currency === 'USD')!;
      expect(usdRow.amount).toBe(aliceBefore);
    });

    it('does NOT touch a still-open (stuck) escrow\'s own row, even if old — hasOpenEscrow keeps seeing it', async () => {
      ledger.grant('alice');
      ledger.escrow('alice', 'stuck-1', 50, 'USD'); // never settled — genuinely stuck/still-open
      backdateMatch('stuck-1', 15);
      backdateStandalone('alice', 15);

      const before = ledger.getBalance('alice', 'USD');
      await ledger.compactOldTransactions(10);

      expect(ledger.getBalance('alice', 'USD')).toBe(before); // unaffected either way, but confirm
      expect(ledger.hasOpenEscrow('alice')).toBe(true); // the escrow row itself must still exist
      expect(ledger.getOpenEscrowMatchIds('alice')).toContain('stuck-1');
    });

    it('a match with only PARTIALLY old rows is excluded entirely (the whole group must age out together)', async () => {
      ledger.grant('alice');
      ledger.grant('bob');
      ledger.escrow('alice', 'mixed-age-1', 100, 'USD');
      ledger.escrow('bob', 'mixed-age-1', 100, 'USD');
      ledger.settle('mixed-age-1', 'win', 'alice', 200, 0.1, 'USD');
      // Only backdate alice's own escrow row directly — bob's escrow + the settlement rows stay
      // "now", so MAX(created_at) for the group is recent. Uses raw SQL since the ledger API has
      // no per-row backdating.
      const oldIso = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare(`UPDATE ledger_entry SET created_at = ? WHERE match_id = 'mixed-age-1' AND account_id = 'alice' AND type = 'BET_ESCROW'`).run(oldIso);

      const result = await ledger.compactOldTransactions(10);
      const aliceRows = rowsFor('alice');
      expect(aliceRows.some((r) => r.match_id === 'mixed-age-1')).toBe(true); // still there, untouched
      expect(aliceRows.some((r) => r.type === 'OPENING_BALANCE')).toBe(false);
      expect(result.accountsCompacted).toBe(0);
    });

    it('BOTH accounts on an old completed match compact together in the same pass (winner AND the platform\'s rake)', async () => {
      ledger.grant('alice');
      ledger.grant('bob');
      ledger.escrow('alice', 'both-sides-1', 100, 'USD');
      ledger.escrow('bob', 'both-sides-1', 100, 'USD');
      ledger.settle('both-sides-1', 'win', 'alice', 200, 0.1, 'USD');
      backdateMatch('both-sides-1', 15);
      backdateStandalone('alice', 15);
      backdateStandalone('bob', 15);

      const result = await ledger.compactOldTransactions(10);
      expect(result.accountsCompacted).toBeGreaterThanOrEqual(3); // alice, bob, PLATFORM

      for (const acct of ['alice', 'bob', PLATFORM_ACCOUNT]) {
        expect(rowsFor(acct).some((r) => r.match_id === 'both-sides-1')).toBe(false);
      }
    });

    it('a second, later compaction round folds the prior OPENING_BALANCE into the next one rather than accumulating multiple', async () => {
      ledger.grant('alice');
      backdateStandalone('alice', 15);
      const r1 = await ledger.compactOldTransactions(10);
      expect(r1.accountsCompacted).toBe(1);
      // Ticket 2026-09-27#7 (D69): one checkpoint PER CURRENCY (USD/SOL/USDT from grant()), not
      // one overall — 3 rows, not 1.
      expect(rowsFor('alice')).toHaveLength(3);
      const firstUsdCheckpoint = rowsFor('alice').find((r) => r.currency === 'USD')!.amount;

      // New activity (USD only), then the checkpoints themselves (stamped "now" at compaction
      // time) also age out — backdateStandalone touches ALL of alice's standalone rows, so the
      // untouched SOL/USDT checkpoints become eligible again too, and re-fold into themselves
      // (same amount, no new activity there) — this is the same "fold, don't accumulate"
      // behavior the test is about, just generalized across all 3 currencies.
      ledger.adminCredit('alice', 250, 'admin-1', 'USD');
      backdateStandalone('alice', 15); // backdates BOTH the checkpoints and the new credit

      const r2 = await ledger.compactOldTransactions(10);
      expect(r2.accountsCompacted).toBe(1);

      const rows = rowsFor('alice');
      expect(rows).toHaveLength(3); // still exactly 3 — folded per currency, not accumulated
      expect(rows.every((r) => r.type === 'OPENING_BALANCE')).toBe(true);
      const usdRow = rows.find((r) => r.currency === 'USD')!;
      expect(usdRow.amount).toBe(firstUsdCheckpoint + 250);
      expect(ledger.getBalance('alice', 'USD')).toBe(firstUsdCheckpoint + 250);
    });

    it('standalone rows (ADMIN_CREDIT/REWARD_CLAIM) compact independently of any match grouping', async () => {
      ledger.grant('alice');
      ledger.adminCredit('alice', 40, 'admin-2', 'USD');
      ledger.creditRewardClaim('alice', 15, 'reward-1', 'USD');
      backdateStandalone('alice', 15);

      const before = ledger.getBalance('alice', 'USD');
      await ledger.compactOldTransactions(10);

      expect(ledger.getBalance('alice', 'USD')).toBe(before);
      // Ticket 2026-09-27#7 (D69): 3 rows — USD folds GRANT+ADMIN_CREDIT+REWARD_CLAIM into one
      // checkpoint, SOL/USDT each fold their own single unchanged GRANT into their own.
      expect(rowsFor('alice')).toHaveLength(3);
    });

    it('nothing eligible: no-ops cleanly', async () => {
      ledger.grant('alice'); // fresh, not backdated
      const result = await ledger.compactOldTransactions(10);
      expect(result).toEqual({ accountsCompacted: 0, rowsDeleted: 0 });
      // Ticket 2026-09-27#7 (D69): grant() writes 3 rows now (USD/SOL/USDT) — all untouched.
      expect(rowsFor('alice')).toHaveLength(3);
    });

    it('batches genuinely yield the event loop between account chunks', async () => {
      for (const name of ['a1', 'a2', 'a3']) {
        ledger.grant(name);
        backdateStandalone(name, 15);
      }
      const immediateSpy = vi.spyOn(global, 'setImmediate');
      try {
        const result = await ledger.compactOldTransactions(10, 1); // batch size 1 -> 3 chunks, 2 yields
        expect(result.accountsCompacted).toBe(3);
        expect(immediateSpy).toHaveBeenCalledTimes(2);
      } finally {
        immediateSpy.mockRestore();
      }
    });
  });

  // Ticket 2026-09-27#7 (D69): a real production deploy against the live snapshot DB crashed on
  // startup with `SqliteError: no such column: currency` — `CREATE TABLE IF NOT EXISTS` is a
  // no-op against an already-existing table, so an existing DB never actually gained the column.
  // No test caught this because every other test here starts from a fresh `:memory:` DB (the
  // CREATE-only path); this describe block is the one place that simulates a real pre-existing
  // snapshot, the same way identity.test.ts's own avatar_id migration test already does.
  describe('currency column migration (snapshot-safe, ADR-011)', () => {
    it('a ledger_entry row predating the currency column reads back as USD after migration', () => {
      const migDb = new Database(':memory:');
      // Simulate a RESTORED OLD SNAPSHOT: a ledger_entry table WITHOUT currency, with a legacy row.
      migDb.exec(`
        CREATE TABLE ledger_entry (
          id              TEXT PRIMARY KEY,
          account_id      TEXT NOT NULL,
          match_id        TEXT,
          type            TEXT NOT NULL,
          amount          INTEGER NOT NULL,
          idempotency_key TEXT NOT NULL UNIQUE,
          created_at      TEXT NOT NULL
        )
      `);
      migDb
        .prepare(
          `INSERT INTO ledger_entry (id, account_id, match_id, type, amount, idempotency_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('e1', 'legacy-alice', null, 'GRANT', 1000, 'grant:legacy-alice', new Date().toISOString());
      // createLedger runs the ALTER migration on the existing table; the old row inherits USD.
      expect(() => createLedger(migDb)).not.toThrow();
      const migLedger = createLedger(migDb);
      expect(migLedger.getBalance('legacy-alice', 'USD')).toBe(1000);
      expect(migLedger.getEntries('legacy-alice')).toHaveLength(1);
      expect(migLedger.getEntries('legacy-alice')[0].currency).toBe('USD');
    });

    it('the migration is idempotent — re-initialising over the same db does not throw or duplicate the column', () => {
      const migDb = new Database(':memory:');
      migDb.exec(`
        CREATE TABLE ledger_entry (
          id              TEXT PRIMARY KEY,
          account_id      TEXT NOT NULL,
          match_id        TEXT,
          type            TEXT NOT NULL,
          amount          INTEGER NOT NULL,
          idempotency_key TEXT NOT NULL UNIQUE,
          created_at      TEXT NOT NULL
        )
      `);
      const l1 = createLedger(migDb);
      l1.grant('bob');
      // Running init again (as a snapshot restore / second buildApp would) must not throw a
      // duplicate-column error, and must not touch existing data.
      expect(() => createLedger(migDb)).not.toThrow();
      const l3 = createLedger(migDb);
      expect(l3.getBalance('bob', 'USD')).toBe(GRANT_AMOUNT);
    });
  });
});
