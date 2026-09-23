import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { LedgerEntry, LedgerEntryType } from '@rapidclash/shared';

export const PLATFORM_ACCOUNT = 'PLATFORM';
export const GRANT_AMOUNT = 1000;

interface DbRow {
  id: string;
  account_id: string;
  match_id: string | null;
  type: string;
  amount: number;
  idempotency_key: string;
  created_at: string;
}

export interface Ledger {
  grant(accountId: string): LedgerEntry;
  escrow(accountId: string, matchId: string, amount: number): LedgerEntry;
  refundEscrow(accountId: string, matchId: string): LedgerEntry;
  settle(
    matchId: string,
    outcome: 'win' | 'draw' | 'void',
    winnerId: string | undefined,
    potAmount: number,
    feeRate: number,
  ): void;
  adminCredit(accountId: string, amount: number, idempotencyKey: string): LedgerEntry;
  /** Credit an account's wallet with a claimed reward (rakeback + volume bonus previously
   *  accrued into the Rewards module's `claimable_balance` — issue #306). Same append-only
   *  shape as `adminCredit` (a single positive-amount entry) but its own ledger type, so a
   *  reward claim is distinguishable from an admin action in the ledger/audit trail. The
   *  Rewards module supplies a deterministic idempotencyKey (derived from its own per-account
   *  claim sequence, not client-supplied) so a retried/duplicated call is a no-op here too —
   *  belt-and-suspenders alongside the Rewards module's own atomic zero-then-credit guard. */
  creditRewardClaim(accountId: string, amount: number, idempotencyKey: string): LedgerEntry;
  accountExists(accountId: string): boolean;
  /** Ticket 2026-09-24#1: prunes `ledger_entry` rows for a fully-refunded match_id group —
   *  every row in the group is BET_ESCROW/SETTLE_REFUND (never a win, and never a still-open
   *  escrow with no settlement at all), AND the group's own MAX(created_at) is older than
   *  `retentionDays`. Money-neutral by construction: a BET_ESCROW and its matching
   *  SETTLE_REFUND always sum to exactly zero, so deleting both never changes any account's
   *  `getBalance()`. Root cause: bot resters' own post→expire→refund→repost cycle (ADR-010,
   *  working as designed) drove the live DB to 371MB, almost entirely this one signature.
   *  Batched (bounded chunk size, `setImmediate` between chunks) regardless of backlog size —
   *  a single large synchronous DELETE would recreate the exact 2026-09-22#7 incident (a big
   *  blocking DB op stalling the single-threaded server inline with live requests). Resolves
   *  once every eligible group has been deleted. */
  cleanupSettled(
    retentionDays: number,
    batchSize?: number,
  ): Promise<{ matchesDeleted: number; rowsDeleted: number }>;
  /** True if the account holds any escrowed stake that has not yet been settled —
   *  i.e. a BET_ESCROW on a match with no settlement entry (SETTLE_WIN, SETTLE_REFUND
   *  or RAKE). Covers both a live match in progress and a resting open challenge
   *  (which escrows on creation).
   *  The single money-safety guard for the soft reset: never free an alias whose
   *  stake is still locked in a pot. */
  hasOpenEscrow(accountId: string): boolean;
  getBalance(accountId: string): number;
  getEntries(accountId: string): LedgerEntry[];
}

export function createLedger(db: Database.Database): Ledger {

  db.exec(`
    CREATE TABLE IF NOT EXISTS ledger_entry (
      id              TEXT PRIMARY KEY,
      account_id      TEXT NOT NULL,
      match_id        TEXT,
      type            TEXT NOT NULL,
      amount          INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger_entry (account_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_match   ON ledger_entry (match_id);
  `);

  const stmtInsert = db.prepare<[string, string, string | null, string, number, string, string]>(
    `INSERT OR IGNORE INTO ledger_entry
       (id, account_id, match_id, type, amount, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const stmtGetByKey = db.prepare<[string], DbRow>(
    `SELECT * FROM ledger_entry WHERE idempotency_key = ?`,
  );

  const stmtBalance = db.prepare<[string], { total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entry WHERE account_id = ?`,
  );

  const stmtEntries = db.prepare<[string], DbRow>(
    `SELECT * FROM ledger_entry WHERE account_id = ? ORDER BY rowid ASC`,
  );

  const stmtHasEntries = db.prepare<[string], { cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM ledger_entry WHERE account_id = ?`,
  );

  const stmtSettleCheck = db.prepare<[string], { cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM ledger_entry
     WHERE match_id = ? AND type IN ('SETTLE_WIN', 'SETTLE_REFUND', 'RAKE')`,
  );

  const stmtEscrows = db.prepare<[string], { account_id: string; amount: number }>(
    `SELECT account_id, ABS(amount) AS amount FROM ledger_entry
     WHERE match_id = ? AND type = 'BET_ESCROW'`,
  );

  // Open escrow = a BET_ESCROW for this account whose match has no settlement entry
  // yet. A live match (not settled) and a resting open challenge (escrowed, never
  // matched) both qualify; a finished match (win → SETTLE_WIN/RAKE, draw/void →
  // SETTLE_REFUND) does not. This is the money-safety guard for the soft reset.
  const stmtOpenEscrow = db.prepare<[string], { cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM ledger_entry e
     WHERE e.account_id = ? AND e.type = 'BET_ESCROW'
       AND NOT EXISTS (
         SELECT 1 FROM ledger_entry s
         WHERE s.match_id = e.match_id
           AND s.type IN ('SETTLE_WIN', 'SETTLE_REFUND', 'RAKE')
       )`,
  );

  function rowToEntry(row: DbRow): LedgerEntry {
    const entry: LedgerEntry = {
      id: row.id,
      type: row.type as LedgerEntryType,
      amount: row.amount,
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at,
    };
    if (row.match_id !== null) entry.matchId = row.match_id;
    return entry;
  }

  function writeEntry(
    accountId: string,
    matchId: string | null,
    type: LedgerEntryType,
    amount: number,
    idempotencyKey: string,
  ): LedgerEntry {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const result = stmtInsert.run(id, accountId, matchId, type, amount, idempotencyKey, createdAt);
    if (result.changes === 0) {
      // Duplicate key — idempotent call; return the existing row.
      return rowToEntry(stmtGetByKey.get(idempotencyKey)!);
    }
    const entry: LedgerEntry = { id, type, amount, idempotencyKey, createdAt };
    if (matchId !== null) entry.matchId = matchId;
    return entry;
  }

  function getBalance(accountId: string): number {
    return stmtBalance.get(accountId)!.total;
  }

  function getEntries(accountId: string): LedgerEntry[] {
    return stmtEntries.all(accountId).map(rowToEntry);
  }

  function grant(accountId: string): LedgerEntry {
    return writeEntry(accountId, null, 'GRANT', GRANT_AMOUNT, `grant:${accountId}`);
  }

  function escrow(accountId: string, matchId: string, amount: number): LedgerEntry {
    if (amount <= 0) throw new RangeError('Escrow amount must be a positive integer');
    if (getBalance(accountId) < amount) throw new Error('Insufficient balance for escrow');
    return writeEntry(accountId, matchId, 'BET_ESCROW', -amount, `escrow:${matchId}:${accountId}`);
  }

  function refundEscrow(accountId: string, matchId: string): LedgerEntry {
    const rows = stmtEscrows.all(matchId);
    const playerEscrow = rows.find((r) => r.account_id === accountId);
    if (!playerEscrow) {
      throw new Error(`No BET_ESCROW entry found for account ${accountId} in match ${matchId}`);
    }
    return writeEntry(
      accountId,
      matchId,
      'SETTLE_REFUND',
      playerEscrow.amount,
      `refund:escrow:${matchId}:${accountId}`,
    );
  }

  function settle(
    matchId: string,
    outcome: 'win' | 'draw' | 'void',
    winnerId: string | undefined,
    potAmount: number,
    feeRate: number,
  ): void {
    if (stmtSettleCheck.get(matchId)!.cnt > 0) return; // idempotent no-op

    const txn = db.transaction(() => {
      if (outcome === 'win') {
        if (!winnerId) throw new Error('winnerId required for win outcome');
        const rake = Math.round(potAmount * feeRate);
        writeEntry(winnerId, matchId, 'SETTLE_WIN', potAmount - rake, `settle:${matchId}:win`);
        if (rake > 0) {
          writeEntry(PLATFORM_ACCOUNT, matchId, 'RAKE', rake, `settle:${matchId}:rake`);
        }
      } else {
        // draw or void: return each player's own stake, no rake
        const escrows = stmtEscrows.all(matchId);
        for (const e of escrows) {
          writeEntry(
            e.account_id,
            matchId,
            'SETTLE_REFUND',
            e.amount,
            `settle:${matchId}:refund:${e.account_id}`,
          );
        }
      }
    });

    txn();
  }

  const DEFAULT_CLEANUP_BATCH_SIZE = 500;

  // A fully-refunded group: every row is BET_ESCROW/SETTLE_REFUND (excludes a win, which
  // always has SETTLE_WIN/RAKE) AND at least one row IS a SETTLE_REFUND (excludes a still-open
  // escrow — a resting challenge not yet expired, or a live in-progress match — which has no
  // settlement row of any kind yet). The age cutoff is applied against the group's OWN latest
  // row, not the escrow's — so a group only qualifies once every row in it (escrow AND
  // refund) predates the retention window.
  const stmtEligibleMatches = db.prepare<[string], { match_id: string }>(
    `SELECT match_id FROM ledger_entry
     WHERE match_id IS NOT NULL
     GROUP BY match_id
     HAVING SUM(CASE WHEN type NOT IN ('BET_ESCROW', 'SETTLE_REFUND') THEN 1 ELSE 0 END) = 0
        AND SUM(CASE WHEN type = 'SETTLE_REFUND' THEN 1 ELSE 0 END) >= 1
        AND MAX(created_at) < ?`,
  );

  async function cleanupSettled(
    retentionDays: number,
    batchSize: number = DEFAULT_CLEANUP_BATCH_SIZE,
  ): Promise<{ matchesDeleted: number; rowsDeleted: number }> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const eligible = stmtEligibleMatches.all(cutoff).map((r) => r.match_id);

    let matchesDeleted = 0;
    let rowsDeleted = 0;
    for (let i = 0; i < eligible.length; i += batchSize) {
      const chunk = eligible.slice(i, i + batchSize);
      const placeholders = chunk.map(() => '?').join(',');
      const deleteChunk = db.transaction((ids: string[]) =>
        db.prepare(`DELETE FROM ledger_entry WHERE match_id IN (${placeholders})`).run(...ids),
      );
      const result = deleteChunk(chunk);
      matchesDeleted += chunk.length;
      rowsDeleted += result.changes;

      // Yield the event loop between batches — regardless of backlog size — so a large
      // (e.g. the first-ever backlog-clearing) pass never blocks a live request the way the
      // 2026-09-22#7 incident's unbounded socket-cleanup path did.
      if (i + batchSize < eligible.length) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    return { matchesDeleted, rowsDeleted };
  }

  function accountExists(accountId: string): boolean {
    return stmtHasEntries.get(accountId)!.cnt > 0;
  }

  function hasOpenEscrow(accountId: string): boolean {
    return stmtOpenEscrow.get(accountId)!.cnt > 0;
  }

  function adminCredit(accountId: string, amount: number, idempotencyKey: string): LedgerEntry {
    if (amount <= 0) throw new RangeError('Credit amount must be a positive integer');
    return writeEntry(accountId, null, 'ADMIN_CREDIT', amount, idempotencyKey);
  }

  function creditRewardClaim(accountId: string, amount: number, idempotencyKey: string): LedgerEntry {
    if (amount <= 0) throw new RangeError('Reward claim amount must be a positive integer');
    return writeEntry(accountId, null, 'REWARD_CLAIM', amount, idempotencyKey);
  }

  return {
    grant,
    escrow,
    refundEscrow,
    settle,
    adminCredit,
    creditRewardClaim,
    accountExists,
    cleanupSettled,
    hasOpenEscrow,
    getBalance,
    getEntries,
  };
}
