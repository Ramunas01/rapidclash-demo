import { describe, beforeEach, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
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
    expect(ledger.getBalance('alice')).toBe(GRANT_AMOUNT);
  });

  it('unknown account has zero balance', () => {
    expect(ledger.getBalance('nobody')).toBe(0);
  });

  it('escrow reduces balance by the staked amount', () => {
    ledger.grant('alice');
    ledger.escrow('alice', 'match-1', 100);
    expect(ledger.getBalance('alice')).toBe(GRANT_AMOUNT - 100);
  });

  it('escrowing more than balance throws', () => {
    ledger.grant('alice');
    expect(() => ledger.escrow('alice', 'match-1', GRANT_AMOUNT + 1)).toThrow();
  });

  it('escrowing with zero amount throws', () => {
    ledger.grant('alice');
    expect(() => ledger.escrow('alice', 'match-1', 0)).toThrow();
  });

  it('win settlement: sum across all accounts is zero (money conserved)', () => {
    ledger.grant('alice');
    ledger.grant('bob');
    ledger.escrow('alice', 'match-win', 100);
    ledger.escrow('bob', 'match-win', 100);

    // pot = 200, feeRate = 10% → rake = 20, winner gets 180
    ledger.settle('match-win', 'win', 'alice', 200, 0.1);

    const alice = ledger.getBalance('alice');
    const bob = ledger.getBalance('bob');
    const platform = ledger.getBalance(PLATFORM_ACCOUNT);

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
    ledger.escrow('alice', 'match-draw', 150);
    ledger.escrow('bob', 'match-draw', 150);

    ledger.settle('match-draw', 'draw', undefined, 300, 0.1);

    const alice = ledger.getBalance('alice');
    const bob = ledger.getBalance('bob');
    const platform = ledger.getBalance(PLATFORM_ACCOUNT);

    expect(alice).toBe(GRANT_AMOUNT);
    expect(bob).toBe(GRANT_AMOUNT);
    expect(platform).toBe(0);
    expect(alice + bob + platform).toBe(2 * GRANT_AMOUNT);
  });

  it('void settlement: each player refunded in full, no rake', () => {
    ledger.grant('alice');
    ledger.grant('bob');
    ledger.escrow('alice', 'match-void', 200);
    ledger.escrow('bob', 'match-void', 200);

    ledger.settle('match-void', 'void', undefined, 400, 0.05);

    expect(ledger.getBalance('alice')).toBe(GRANT_AMOUNT);
    expect(ledger.getBalance('bob')).toBe(GRANT_AMOUNT);
    expect(ledger.getBalance(PLATFORM_ACCOUNT)).toBe(0);
  });

  it('settle is idempotent: replaying the same match_id is a no-op', () => {
    ledger.grant('alice');
    ledger.grant('bob');
    ledger.escrow('alice', 'match-idem', 100);
    ledger.escrow('bob', 'match-idem', 100);

    ledger.settle('match-idem', 'win', 'alice', 200, 0.1);
    const balanceAfterFirst = ledger.getBalance('alice');
    const entriesAfterFirst = ledger.getEntries('alice').length;

    ledger.settle('match-idem', 'win', 'alice', 200, 0.1);

    expect(ledger.getBalance('alice')).toBe(balanceAfterFirst);
    expect(ledger.getEntries('alice').length).toBe(entriesAfterFirst);
  });

  it('escrow is idempotent: double-tap escrows once', () => {
    ledger.grant('alice');
    ledger.escrow('alice', 'match-esc-idem', 100);
    ledger.escrow('alice', 'match-esc-idem', 100); // same key — no-op
    expect(ledger.getBalance('alice')).toBe(GRANT_AMOUNT - 100);
  });

  it('getEntries returns all entries for an account in order', () => {
    ledger.grant('alice');
    ledger.escrow('alice', 'match-entries', 50);
    const entries = ledger.getEntries('alice');
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe('GRANT');
    expect(entries[1].type).toBe('BET_ESCROW');
    expect(entries[1].matchId).toBe('match-entries');
  });

  it('grant is idempotent: same account_id grants once', () => {
    ledger.grant('alice');
    ledger.grant('alice'); // duplicate — ignored
    expect(ledger.getBalance('alice')).toBe(GRANT_AMOUNT);
  });

  describe('hasOpenEscrow (soft-reset money-safety guard)', () => {
    it('is false for an account with no escrows', () => {
      ledger.grant('alice');
      expect(ledger.hasOpenEscrow('alice')).toBe(false);
    });

    it('is true while a match is escrowed but unsettled (live match)', () => {
      ledger.grant('alice');
      ledger.grant('bob');
      ledger.escrow('alice', 'live-match', 100);
      ledger.escrow('bob', 'live-match', 100);
      expect(ledger.hasOpenEscrow('alice')).toBe(true);
      expect(ledger.hasOpenEscrow('bob')).toBe(true);
    });

    it('is true for a resting open challenge (escrowed, never matched/settled)', () => {
      ledger.grant('alice');
      ledger.escrow('alice', 'resting-challenge', 100);
      expect(ledger.hasOpenEscrow('alice')).toBe(true);
    });

    it('is false again once the match settles as a win (winner AND loser)', () => {
      ledger.grant('alice');
      ledger.grant('bob');
      ledger.escrow('alice', 'm-win', 100);
      ledger.escrow('bob', 'm-win', 100);
      ledger.settle('m-win', 'win', 'alice', 200, 0.1);
      expect(ledger.hasOpenEscrow('alice')).toBe(false); // winner: SETTLE_WIN exists
      expect(ledger.hasOpenEscrow('bob')).toBe(false); // loser: match has SETTLE_WIN/RAKE
    });

    it('is false again once the match settles as a draw (both refunded)', () => {
      ledger.grant('alice');
      ledger.grant('bob');
      ledger.escrow('alice', 'm-draw', 100);
      ledger.escrow('bob', 'm-draw', 100);
      ledger.settle('m-draw', 'draw', undefined, 200, 0.1);
      expect(ledger.hasOpenEscrow('alice')).toBe(false);
      expect(ledger.hasOpenEscrow('bob')).toBe(false);
    });

    it('an unsettled escrow on ONE match keeps the guard true despite other settled matches', () => {
      ledger.grant('alice');
      ledger.grant('bob');
      ledger.escrow('alice', 'm-done', 100);
      ledger.escrow('bob', 'm-done', 100);
      ledger.settle('m-done', 'win', 'bob', 200, 0.1);
      ledger.escrow('alice', 'm-open', 100); // still in flight
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
      ledger.escrow('alice', 'expired-1', 50);
      ledger.refundEscrow('alice', 'expired-1');
      backdate('expired-1', 5);

      const result = await ledger.cleanupSettled(2);
      expect(result).toEqual({ matchesDeleted: 1, rowsDeleted: 2 });
      expect(rowCount('expired-1')).toBe(0);
    });

    it('deletes an old draw (BET_ESCROW×2 + SETTLE_REFUND×2, two accounts)', async () => {
      ledger.grant('alice');
      ledger.grant('bob');
      ledger.escrow('alice', 'old-draw', 100);
      ledger.escrow('bob', 'old-draw', 100);
      ledger.settle('old-draw', 'draw', undefined, 200, 0.1);
      backdate('old-draw', 5);

      const result = await ledger.cleanupSettled(2);
      expect(result).toEqual({ matchesDeleted: 1, rowsDeleted: 4 });
      expect(rowCount('old-draw')).toBe(0);
    });

    it('leaves a still-open resting challenge untouched (BET_ESCROW only, no refund yet — not expired)', async () => {
      ledger.grant('alice');
      ledger.escrow('alice', 'still-resting', 50);
      backdate('still-resting', 5); // old, but never refunded — must survive

      const result = await ledger.cleanupSettled(2);
      expect(result).toEqual({ matchesDeleted: 0, rowsDeleted: 0 });
      expect(rowCount('still-resting')).toBe(1);
    });

    it('leaves a still-open live match untouched (BET_ESCROW×2, unsettled)', async () => {
      ledger.grant('alice');
      ledger.grant('bob');
      ledger.escrow('alice', 'live-match', 100);
      ledger.escrow('bob', 'live-match', 100);
      backdate('live-match', 5);

      const result = await ledger.cleanupSettled(2);
      expect(result).toEqual({ matchesDeleted: 0, rowsDeleted: 0 });
      expect(rowCount('live-match')).toBe(2);
    });

    it('leaves a won match untouched (SETTLE_WIN/RAKE present — never eligible, regardless of age)', async () => {
      ledger.grant('alice');
      ledger.grant('bob');
      ledger.escrow('alice', 'old-win', 100);
      ledger.escrow('bob', 'old-win', 100);
      ledger.settle('old-win', 'win', 'alice', 200, 0.1);
      backdate('old-win', 5);

      const result = await ledger.cleanupSettled(2);
      expect(result).toEqual({ matchesDeleted: 0, rowsDeleted: 0 });
      expect(rowCount('old-win')).toBe(4); // 2 escrows + SETTLE_WIN + RAKE
    });

    it('age cutoff: an otherwise-eligible refund NEWER than the retention window is left alone', async () => {
      ledger.grant('alice');
      ledger.escrow('alice', 'recent-refund', 50);
      ledger.refundEscrow('alice', 'recent-refund'); // created_at = now, no backdating

      const result = await ledger.cleanupSettled(2);
      expect(result).toEqual({ matchesDeleted: 0, rowsDeleted: 0 });
      expect(rowCount('recent-refund')).toBe(2);
    });

    it('is money-neutral: getBalance for the pruned account is unchanged before/after cleanup', async () => {
      ledger.grant('alice');
      ledger.escrow('alice', 'neutral-check', 50);
      ledger.refundEscrow('alice', 'neutral-check');
      backdate('neutral-check', 5);
      const before = ledger.getBalance('alice');

      await ledger.cleanupSettled(2);

      expect(ledger.getBalance('alice')).toBe(before);
      expect(ledger.getBalance('alice')).toBe(GRANT_AMOUNT); // escrow(-50) + refund(+50) = net 0
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
        ledger.escrow(`acct-${m}`, m, 10);
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
      ledger.escrow('alice', 'one-chunk', 50);
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
});
