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
  accountExists(accountId: string): boolean;
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

  function accountExists(accountId: string): boolean {
    return stmtHasEntries.get(accountId)!.cnt > 0;
  }

  function adminCredit(accountId: string, amount: number, idempotencyKey: string): LedgerEntry {
    if (amount <= 0) throw new RangeError('Credit amount must be a positive integer');
    return writeEntry(accountId, null, 'ADMIN_CREDIT', amount, idempotencyKey);
  }

  return { grant, escrow, refundEscrow, settle, adminCredit, accountExists, getBalance, getEntries };
}
