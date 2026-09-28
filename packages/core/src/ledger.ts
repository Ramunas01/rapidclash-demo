import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { LedgerEntry, LedgerEntryType, Currency } from '@rapidclash/shared';
import { CURRENCIES, STARTING_BALANCE } from '@rapidclash/shared';

export const PLATFORM_ACCOUNT = 'PLATFORM';
export const GRANT_AMOUNT = 1000;

interface DbRow {
  id: string;
  account_id: string;
  match_id: string | null;
  type: string;
  amount: number;
  currency: string;
  idempotency_key: string;
  created_at: string;
}

export interface Ledger {
  /** Ticket 2026-09-27#7 (D69): credits every `STARTING_BALANCE` currency in one call — today
   *  that's USD/SOL/USDT (a currency absent from that table implicitly starts at 0, no row
   *  needed). Returns the USD entry specifically, preserving the pre-D69 return contract (no
   *  caller was found to use the return value for anything beyond its existence/logging). */
  grant(accountId: string): LedgerEntry;
  escrow(accountId: string, matchId: string, amount: number, currency: Currency): LedgerEntry;
  /** No `currency` param — a refund always returns money to whichever bucket it was originally
   *  escrowed from, read off the stored escrow row itself. A caller never needs to know it. */
  refundEscrow(accountId: string, matchId: string): LedgerEntry;
  /** `winnerCurrency` is required (throws) when `outcome === 'win'` — the winner's OWN selected
   *  currency for this match, credited with their payout; the platform's RAKE cut is tracked in
   *  that same currency. The draw/void branch needs no currency argument at all: it refunds each
   *  escrow into ITS OWN stored currency, so two players who selected different currencies for
   *  the same match still each get refunded correctly with zero reconciliation between them. */
  settle(
    matchId: string,
    outcome: 'win' | 'draw' | 'void',
    winnerId: string | undefined,
    potAmount: number,
    feeRate: number,
    winnerCurrency?: Currency,
  ): void;
  adminCredit(accountId: string, amount: number, idempotencyKey: string, currency: Currency): LedgerEntry;
  /** Credit an account's wallet with a claimed reward (rakeback + volume bonus previously
   *  accrued into the Rewards module's `claimable_balance` — issue #306). Same append-only
   *  shape as `adminCredit` (a single positive-amount entry) but its own ledger type, so a
   *  reward claim is distinguishable from an admin action in the ledger/audit trail. The
   *  Rewards module supplies a deterministic idempotencyKey (derived from its own per-account
   *  claim sequence, not client-supplied) so a retried/duplicated call is a no-op here too —
   *  belt-and-suspenders alongside the Rewards module's own atomic zero-then-credit guard. */
  creditRewardClaim(accountId: string, amount: number, idempotencyKey: string, currency: Currency): LedgerEntry;
  accountExists(accountId: string): boolean;
  /** Ticket 2026-09-24#1: prunes `ledger_entry` rows for a fully-refunded match_id group —
   *  every row in the group is BET_ESCROW/SETTLE_REFUND (never a win, and never a still-open
   *  escrow with no settlement at all), AND the group's own MAX(created_at) is older than
   *  `retentionDays`. Money-neutral by construction: a BET_ESCROW and its matching
   *  SETTLE_REFUND always sum to exactly zero (in the SAME currency, since a refund always
   *  mirrors its own escrow's currency — ticket 2026-09-27#7), so deleting both never changes
   *  any account's `getBalance()` in any currency. Root cause: bot resters' own post→expire→
   *  refund→repost cycle (ADR-010, working as designed) drove the live DB to 371MB, almost
   *  entirely this one signature. Batched (bounded chunk size, `setImmediate` between chunks)
   *  regardless of backlog size — a single large synchronous DELETE would recreate the exact
   *  2026-09-22#7 incident (a big blocking DB op stalling the single-threaded server inline with
   *  live requests). Resolves once every eligible group has been deleted. */
  cleanupSettled(
    retentionDays: number,
    batchSize?: number,
  ): Promise<{ matchesDeleted: number; rowsDeleted: number }>;
  /** True if the account holds any escrowed stake, in ANY currency, that has not yet been
   *  settled — i.e. a BET_ESCROW on a match with no settlement entry (SETTLE_WIN, SETTLE_REFUND
   *  or RAKE). Covers both a live match in progress and a resting open challenge (which escrows
   *  on creation). Currency-agnostic by design: the money-safety guard for the soft reset must
   *  refuse to free an alias with ANY stake locked in ANY pot, not just its USD one. */
  hasOpenEscrow(accountId: string): boolean;
  /** Ticket 2026-09-24#2: same definition of "open" as {@link hasOpenEscrow} (a BET_ESCROW with
   *  no settlement entry of any kind yet), but returns every matching match_id instead of just
   *  a boolean — the self-healing reconciliation check at `joinQueue`/`takeChallenge` needs the
   *  actual list to test each one against the in-memory "still legitimately active" maps
   *  (`matches`/`entryByMatchId` in matchmaking.ts), not merely "does at least one exist."
   *  Currency-agnostic, same reasoning as {@link hasOpenEscrow}. */
  getOpenEscrowMatchIds(accountId: string): string[];
  /** Ticket 2026-09-24#4: compacts each account's own REAL transaction history older than
   *  `retentionDays` into one synthetic OPENING_BALANCE checkpoint PER CURRENCY (amount = exact
   *  sum of what was deleted, in that currency) — the standard ledger-checkpoint pattern.
   *  Ticket 2026-09-27#7's own correctness note: once rows can span multiple currencies,
   *  summing them into a single cross-currency checkpoint would be meaningless (mixing e.g. SOL
   *  credits with USD credits as one number) — so eligible rows are grouped by (account,
   *  currency) first, one checkpoint written per group that has any eligible rows. Unlike
   *  {@link cleanupSettled} (which only ever deletes zero-sum BET_ESCROW/SETTLE_REFUND pairs,
   *  safe to remove outright), this touches non-zero-sum rows (GRANT, SETTLE_WIN, RAKE,
   *  ADMIN_CREDIT, REWARD_CLAIM, and a prior OPENING_BALANCE itself), so `getBalance()` (a bare
   *  SUM over every row for that account+currency) would be silently understated forever
   *  without the compensating checkpoint entry first.
   *
   *  A match-scoped row (BET_ESCROW/SETTLE_WIN/SETTLE_REFUND/RAKE) is only ever included if the
   *  WHOLE match_id group — every row, across every account, not just this one — is both fully
   *  resolved (has at least one settlement-type row) AND older than the cutoff. This is the
   *  correctness-critical guard: compacting away a still-open (stuck) escrow's own row would
   *  make it silently invisible to {@link hasOpenEscrow}/{@link getOpenEscrowMatchIds} forever
   *  (ticket 2026-09-24#2's own reconciliation depends on that row existing to detect it);
   *  compacting one side of an already-settled match's rows while leaving the other would make
   *  an already-resolved match look "open" again, risking a double-refund. A standalone row
   *  (NULL match_id: GRANT/ADMIN_CREDIT/REWARD_CLAIM/OPENING_BALANCE) has no such grouping
   *  concern and is eligible purely on its own age.
   *
   *  `accountsCompacted` counts distinct ACCOUNTS processed this pass (unchanged semantics from
   *  pre-D69), not the number of per-currency checkpoints written — an account with eligible
   *  rows in 2 currencies still counts once, even though it gets 2 checkpoints.
   *
   *  Self-maintaining: each new checkpoint's own `created_at` is stamped at compaction time (now,
   *  not backdated), so it naturally becomes eligible for a LATER compaction round on its own —
   *  an account only ever holds one OPENING_BALANCE per currency at a time. Batched per-account
   *  (bounded chunk size, `setImmediate` between chunks), same reasoning as {@link cleanupSettled}. */
  compactOldTransactions(
    retentionDays: number,
    batchSize?: number,
  ): Promise<{ accountsCompacted: number; rowsDeleted: number }>;
  getBalance(accountId: string, currency: Currency): number;
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
      currency        TEXT NOT NULL DEFAULT 'USD',
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger_entry (account_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_match   ON ledger_entry (match_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_account_currency ON ledger_entry (account_id, currency);
  `);

  const stmtInsert = db.prepare<[string, string, string | null, string, number, string, string, string]>(
    `INSERT OR IGNORE INTO ledger_entry
       (id, account_id, match_id, type, amount, currency, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const stmtGetByKey = db.prepare<[string], DbRow>(
    `SELECT * FROM ledger_entry WHERE idempotency_key = ?`,
  );

  const stmtBalance = db.prepare<[string, string], { total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entry WHERE account_id = ? AND currency = ?`,
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

  const stmtEscrows = db.prepare<[string], { account_id: string; amount: number; currency: string }>(
    `SELECT account_id, ABS(amount) AS amount, currency FROM ledger_entry
     WHERE match_id = ? AND type = 'BET_ESCROW'`,
  );

  // Open escrow = a BET_ESCROW for this account whose match has no settlement entry
  // yet. A live match (not settled) and a resting open challenge (escrowed, never
  // matched) both qualify; a finished match (win → SETTLE_WIN/RAKE, draw/void →
  // SETTLE_REFUND) does not. This is the money-safety guard for the soft reset.
  // Currency-agnostic (no `currency` filter) — an open escrow in ANY currency must block it.
  const stmtOpenEscrow = db.prepare<[string], { cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM ledger_entry e
     WHERE e.account_id = ? AND e.type = 'BET_ESCROW'
       AND NOT EXISTS (
         SELECT 1 FROM ledger_entry s
         WHERE s.match_id = e.match_id
           AND s.type IN ('SETTLE_WIN', 'SETTLE_REFUND', 'RAKE')
       )`,
  );

  // Same "open" definition as stmtOpenEscrow above, returning the actual match_ids instead of
  // just a count (ticket 2026-09-24#2's self-healing reconciliation check).
  const stmtOpenEscrowMatchIds = db.prepare<[string], { match_id: string }>(
    `SELECT e.match_id AS match_id FROM ledger_entry e
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
      currency: row.currency as Currency,
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
    currency: Currency,
  ): LedgerEntry {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const result = stmtInsert.run(id, accountId, matchId, type, amount, currency, idempotencyKey, createdAt);
    if (result.changes === 0) {
      // Duplicate key — idempotent call; return the existing row.
      return rowToEntry(stmtGetByKey.get(idempotencyKey)!);
    }
    const entry: LedgerEntry = { id, type, amount, currency, idempotencyKey, createdAt };
    if (matchId !== null) entry.matchId = matchId;
    return entry;
  }

  function getBalance(accountId: string, currency: Currency): number {
    return stmtBalance.get(accountId, currency)!.total;
  }

  function getEntries(accountId: string): LedgerEntry[] {
    return stmtEntries.all(accountId).map(rowToEntry);
  }

  function grant(accountId: string): LedgerEntry {
    let usdEntry: LedgerEntry | undefined;
    for (const currency of CURRENCIES) {
      const amount = STARTING_BALANCE[currency];
      if (!amount) continue; // absent from STARTING_BALANCE → implicitly 0, no row needed
      // USD keeps the exact pre-D69 idempotency key (`grant:${accountId}`) — preserves the
      // existing "at most one GRANT per account" invariant/format unchanged. New non-USD
      // grants get their own currency-scoped key.
      const key = currency === 'USD' ? `grant:${accountId}` : `grant:${accountId}:${currency}`;
      const entry = writeEntry(accountId, null, 'GRANT', amount, key, currency);
      if (currency === 'USD') usdEntry = entry;
    }
    return usdEntry!; // 'USD' is always present in STARTING_BALANCE
  }

  function escrow(accountId: string, matchId: string, amount: number, currency: Currency): LedgerEntry {
    if (amount <= 0) throw new RangeError('Escrow amount must be a positive integer');
    if (getBalance(accountId, currency) < amount) throw new Error('Insufficient balance for escrow');
    return writeEntry(accountId, matchId, 'BET_ESCROW', -amount, `escrow:${matchId}:${accountId}`, currency);
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
      playerEscrow.currency as Currency,
    );
  }

  function settle(
    matchId: string,
    outcome: 'win' | 'draw' | 'void',
    winnerId: string | undefined,
    potAmount: number,
    feeRate: number,
    winnerCurrency?: Currency,
  ): void {
    if (stmtSettleCheck.get(matchId)!.cnt > 0) return; // idempotent no-op

    const txn = db.transaction(() => {
      if (outcome === 'win') {
        if (!winnerId) throw new Error('winnerId required for win outcome');
        if (!winnerCurrency) throw new Error('winnerCurrency required for win outcome');
        const rake = Math.round(potAmount * feeRate);
        writeEntry(winnerId, matchId, 'SETTLE_WIN', potAmount - rake, `settle:${matchId}:win`, winnerCurrency);
        if (rake > 0) {
          writeEntry(PLATFORM_ACCOUNT, matchId, 'RAKE', rake, `settle:${matchId}:rake`, winnerCurrency);
        }
      } else {
        // draw or void: return each player's own stake, no rake — each refunded in THEIR OWN
        // stored currency (read off their own escrow row), so two players who selected
        // different currencies for this match still each land back in the right bucket.
        const escrows = stmtEscrows.all(matchId);
        for (const e of escrows) {
          writeEntry(
            e.account_id,
            matchId,
            'SETTLE_REFUND',
            e.amount,
            `settle:${matchId}:refund:${e.account_id}`,
            e.currency as Currency,
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
  // refund) predates the retention window. No currency filter needed — a BET_ESCROW/
  // SETTLE_REFUND pair for one match_id/account is always the same currency by construction
  // (a refund always mirrors its own escrow's currency), so this stays zero-sum per group.
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

  const DEFAULT_COMPACTION_BATCH_SIZE = 200; // accounts per batch, not rows

  // Ticket 2026-09-24#4: a match_id group is compaction-eligible only if it's fully RESOLVED
  // (has at least one settlement-type row — excludes a still-open/stuck escrow, whose own row
  // must never silently vanish from hasOpenEscrow's reach) AND the WHOLE group — every row,
  // across EVERY account, not just one — is older than the cutoff. Deliberately more permissive
  // than stmtEligibleMatches above (which only matches the zero-sum BET_ESCROW/SETTLE_REFUND
  // signature, safe to delete outright): this also covers a genuine completed match
  // (BET_ESCROW×2 + SETTLE_WIN + RAKE), whose rows are NOT zero-sum per account and so need the
  // compensating OPENING_BALANCE checkpoint below rather than an outright delete.
  const stmtEligibleCompactionMatchIds = db.prepare<[string], { match_id: string }>(
    `SELECT match_id FROM ledger_entry
     WHERE match_id IS NOT NULL
     GROUP BY match_id
     HAVING MAX(created_at) < ?
        AND SUM(CASE WHEN type IN ('SETTLE_WIN', 'SETTLE_REFUND', 'RAKE') THEN 1 ELSE 0 END) > 0`,
  );

  // Candidate accounts: anyone with at least one non-checkpoint row older than the cutoff. May
  // include an account whose only old row turns out to be a still-open escrow (excluded by the
  // eligibility query above) — a harmless no-op for that account that pass, not a correctness
  // concern.
  const stmtCompactionCandidateAccounts = db.prepare<[string], { account_id: string }>(
    `SELECT DISTINCT account_id FROM ledger_entry WHERE created_at < ? AND type != 'OPENING_BALANCE'`,
  );

  // This account's own standalone (NULL match_id) rows older than the cutoff — always
  // individually eligible; no match-grouping concern (never shared with another account).
  const stmtAccountStandaloneRows = db.prepare<[string, string], { id: string; amount: number; currency: string }>(
    `SELECT id, amount, currency FROM ledger_entry WHERE account_id = ? AND match_id IS NULL AND created_at < ?`,
  );

  // This account's own match-scoped rows (any age) — filtered in JS against the eligible-match-
  // id set computed ONCE per pass above, so the expensive GROUP BY only ever runs once, not
  // once per candidate account.
  const stmtAccountMatchRows = db.prepare<[string], { id: string; match_id: string; amount: number; currency: string }>(
    `SELECT id, match_id, amount, currency FROM ledger_entry WHERE account_id = ? AND match_id IS NOT NULL`,
  );

  /**
   * Ticket 2026-09-24#4: compacts each account's own real transaction history older than
   * `retentionDays` into one OPENING_BALANCE checkpoint PER CURRENCY (ticket 2026-09-27#7). See
   * the {@link Ledger} interface's own doc comment for the full correctness reasoning (why
   * match-scoped rows need the whole-group eligibility check, why standalone rows don't, and
   * why per-currency grouping is required once a currency dimension exists).
   */
  async function compactOldTransactions(
    retentionDays: number,
    batchSize: number = DEFAULT_COMPACTION_BATCH_SIZE,
  ): Promise<{ accountsCompacted: number; rowsDeleted: number }> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const eligibleMatchIds = new Set(stmtEligibleCompactionMatchIds.all(cutoff).map((r) => r.match_id));
    const candidateAccounts = stmtCompactionCandidateAccounts.all(cutoff).map((r) => r.account_id);

    let accountsCompacted = 0;
    let rowsDeleted = 0;

    for (let i = 0; i < candidateAccounts.length; i += batchSize) {
      const chunk = candidateAccounts.slice(i, i + batchSize);
      for (const accountId of chunk) {
        const standalone = stmtAccountStandaloneRows.all(accountId, cutoff);
        const matchRows = stmtAccountMatchRows.all(accountId).filter((r) => eligibleMatchIds.has(r.match_id));
        const rows: { id: string; amount: number; currency: string }[] = [...standalone, ...matchRows];
        if (rows.length === 0) continue; // nothing eligible for this account this pass

        // Group by currency — a single cross-currency sum would be meaningless (mixing e.g.
        // SOL credits with USD credits as one number). One checkpoint per currency that has
        // eligible rows.
        const byCurrency = new Map<string, { id: string; amount: number }[]>();
        for (const r of rows) {
          const list = byCurrency.get(r.currency) ?? [];
          list.push({ id: r.id, amount: r.amount });
          byCurrency.set(r.currency, list);
        }

        const ids = rows.map((r) => r.id);
        const placeholders = ids.map(() => '?').join(',');

        // Delete the originals, THEN write the compensating checkpoint(s) — same atomic-
        // transaction shape as settle()'s own writes; a fresh, always-unique idempotency key
        // per currency (this is a NEW checkpoint every pass, never intentionally idempotent-
        // collapsible the way an escrow/refund retry is).
        const compactAccount = db.transaction(() => {
          db.prepare(`DELETE FROM ledger_entry WHERE id IN (${placeholders})`).run(...ids);
          for (const [currency, group] of byCurrency) {
            const total = group.reduce((sum, r) => sum + r.amount, 0);
            writeEntry(
              accountId,
              null,
              'OPENING_BALANCE',
              total,
              `compaction:${accountId}:${currency}:${randomUUID()}`,
              currency as Currency,
            );
          }
        });
        compactAccount();

        accountsCompacted += 1;
        rowsDeleted += rows.length;
      }

      // Yield the event loop between account batches — same reasoning as cleanupSettled's own
      // batching (2026-09-22#7: a large synchronous pass must never block a live request).
      if (i + batchSize < candidateAccounts.length) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }

    return { accountsCompacted, rowsDeleted };
  }

  function accountExists(accountId: string): boolean {
    return stmtHasEntries.get(accountId)!.cnt > 0;
  }

  function hasOpenEscrow(accountId: string): boolean {
    return stmtOpenEscrow.get(accountId)!.cnt > 0;
  }

  function getOpenEscrowMatchIds(accountId: string): string[] {
    return stmtOpenEscrowMatchIds.all(accountId).map((r) => r.match_id);
  }

  function adminCredit(accountId: string, amount: number, idempotencyKey: string, currency: Currency): LedgerEntry {
    if (amount <= 0) throw new RangeError('Credit amount must be a positive integer');
    return writeEntry(accountId, null, 'ADMIN_CREDIT', amount, idempotencyKey, currency);
  }

  function creditRewardClaim(accountId: string, amount: number, idempotencyKey: string, currency: Currency): LedgerEntry {
    if (amount <= 0) throw new RangeError('Reward claim amount must be a positive integer');
    return writeEntry(accountId, null, 'REWARD_CLAIM', amount, idempotencyKey, currency);
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
    compactOldTransactions,
    hasOpenEscrow,
    getOpenEscrowMatchIds,
    getBalance,
    getEntries,
  };
}
