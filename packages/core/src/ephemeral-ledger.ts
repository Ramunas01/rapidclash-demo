import { randomUUID } from 'node:crypto';
import type { LedgerEntry, LedgerEntryType } from '@rapidclash/shared';
import { PLATFORM_ACCOUNT, type Ledger } from './ledger.js';

/** Default starting stack for a guest session, per GUEST_MODE_CONTRACT.md §2's stated default. */
export const GUEST_GRANT_AMOUNT = 300;

export interface EphemeralLedger extends Ledger {
  /** Drop every entry for `accountId` from the in-memory store, freeing it. Not part of the
   *  {@link Ledger} contract (a real ledger never forgets) — this is the ephemeral-only escape
   *  hatch the guest session-cleanup policy uses to bound memory growth after a session ends. */
  evict(accountId: string): void;
}

interface StoredEntry extends LedgerEntry {
  accountId: string;
}

/**
 * A second, in-memory implementation of the same {@link Ledger} interface `createLedger`
 * implements against SQLite — `packages/core/src/ledger.ts:18`'s `Ledger` is a plain interface,
 * so this needs no changes there. Balance derivation (sum of entries), idempotency-key
 * deduplication, and settlement semantics mirror `createLedger` exactly; only the storage is
 * different (plain in-memory maps instead of SQLite, gone on process restart).
 *
 * One shared instance serves every guest session concurrently: isolation comes from each guest
 * having a unique `accountId` (their `playerId`), not from one ledger-object-per-session — every
 * method here is already keyed by `accountId`, exactly like the real ledger.
 */
export function createEphemeralLedger(opts: { grantAmount?: number } = {}): EphemeralLedger {
  const grantAmount = opts.grantAmount ?? GUEST_GRANT_AMOUNT;

  const entriesByAccount = new Map<string, StoredEntry[]>();
  const entryByIdempotencyKey = new Map<string, StoredEntry>();
  // match_id -> entries escrowed/settled under it (mirrors the real ledger's `stmtEscrows`/
  // settle-check queries, which scan by match_id).
  const entriesByMatch = new Map<string, StoredEntry[]>();

  function toPublic(e: StoredEntry): LedgerEntry {
    const { accountId: _accountId, ...rest } = e;
    return rest;
  }

  function writeEntry(
    accountId: string,
    matchId: string | null,
    type: LedgerEntryType,
    amount: number,
    idempotencyKey: string,
  ): LedgerEntry {
    const existing = entryByIdempotencyKey.get(idempotencyKey);
    if (existing) return toPublic(existing); // idempotent no-op, mirrors INSERT OR IGNORE

    const entry: StoredEntry = {
      id: randomUUID(),
      accountId,
      type,
      amount,
      idempotencyKey,
      createdAt: new Date().toISOString(),
    };
    if (matchId !== null) entry.matchId = matchId;

    entryByIdempotencyKey.set(idempotencyKey, entry);
    const accountList = entriesByAccount.get(accountId) ?? [];
    accountList.push(entry);
    entriesByAccount.set(accountId, accountList);
    if (matchId !== null) {
      const matchList = entriesByMatch.get(matchId) ?? [];
      matchList.push(entry);
      entriesByMatch.set(matchId, matchList);
    }
    return toPublic(entry);
  }

  function getBalance(accountId: string): number {
    const list = entriesByAccount.get(accountId);
    if (!list) return 0;
    return list.reduce((sum, e) => sum + e.amount, 0);
  }

  function getEntries(accountId: string): LedgerEntry[] {
    return (entriesByAccount.get(accountId) ?? []).map(toPublic);
  }

  function grant(accountId: string): LedgerEntry {
    return writeEntry(accountId, null, 'GRANT', grantAmount, `grant:${accountId}`);
  }

  function escrow(accountId: string, matchId: string, amount: number): LedgerEntry {
    if (amount <= 0) throw new RangeError('Escrow amount must be a positive integer');
    if (getBalance(accountId) < amount) throw new Error('Insufficient balance for escrow');
    return writeEntry(accountId, matchId, 'BET_ESCROW', -amount, `escrow:${matchId}:${accountId}`);
  }

  function refundEscrow(accountId: string, matchId: string): LedgerEntry {
    const rows = entriesByMatch.get(matchId) ?? [];
    const playerEscrow = rows.find((e) => e.type === 'BET_ESCROW' && e.accountId === accountId);
    if (!playerEscrow) {
      throw new Error(`No BET_ESCROW entry found for account ${accountId} in match ${matchId}`);
    }
    return writeEntry(
      accountId,
      matchId,
      'SETTLE_REFUND',
      Math.abs(playerEscrow.amount),
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
    const matchEntries = entriesByMatch.get(matchId) ?? [];
    const alreadySettled = matchEntries.some(
      (e) => e.type === 'SETTLE_WIN' || e.type === 'SETTLE_REFUND' || e.type === 'RAKE',
    );
    if (alreadySettled) return; // idempotent no-op

    if (outcome === 'win') {
      if (!winnerId) throw new Error('winnerId required for win outcome');
      const rake = Math.round(potAmount * feeRate);
      writeEntry(winnerId, matchId, 'SETTLE_WIN', potAmount - rake, `settle:${matchId}:win`);
      if (rake > 0) {
        writeEntry(PLATFORM_ACCOUNT, matchId, 'RAKE', rake, `settle:${matchId}:rake`);
      }
    } else {
      // draw or void: return each player's own stake, no rake
      for (const e of matchEntries.filter((e) => e.type === 'BET_ESCROW')) {
        writeEntry(e.accountId, matchId, 'SETTLE_REFUND', Math.abs(e.amount), `settle:${matchId}:refund:${e.accountId}`);
      }
    }
  }

  function accountExists(accountId: string): boolean {
    return (entriesByAccount.get(accountId)?.length ?? 0) > 0;
  }

  function hasOpenEscrow(accountId: string): boolean {
    return (entriesByAccount.get(accountId) ?? []).some((e) => {
      if (e.type !== 'BET_ESCROW' || !e.matchId) return false;
      const matchEntries = entriesByMatch.get(e.matchId) ?? [];
      return !matchEntries.some((s) => s.type === 'SETTLE_WIN' || s.type === 'SETTLE_REFUND' || s.type === 'RAKE');
    });
  }

  // Ticket 2026-09-24#2: same "open" definition as hasOpenEscrow above, returning the actual
  // match_ids — guest mode is equally subject to the socket force-close race this backs up
  // (guest connections go through the same gateway.ts close-handler/sweepExpired paths), so
  // this needs a genuine implementation here too, not a stub.
  function getOpenEscrowMatchIds(accountId: string): string[] {
    return (entriesByAccount.get(accountId) ?? [])
      .filter((e): e is StoredEntry & { matchId: string } => e.type === 'BET_ESCROW' && e.matchId !== undefined)
      .filter((e) => {
        const matchEntries = entriesByMatch.get(e.matchId) ?? [];
        return !matchEntries.some((s) => s.type === 'SETTLE_WIN' || s.type === 'SETTLE_REFUND' || s.type === 'RAKE');
      })
      .map((e) => e.matchId);
  }

  function adminCredit(accountId: string, amount: number, idempotencyKey: string): LedgerEntry {
    if (amount <= 0) throw new RangeError('Credit amount must be a positive integer');
    return writeEntry(accountId, null, 'ADMIN_CREDIT', amount, idempotencyKey);
  }

  // Rewards (issue #306) is never wired to guest sessions (server.ts only hooks the REAL
  // matchmaking instance's onPlayerSettled into Rewards) — this exists solely to satisfy the
  // `Ledger` interface EphemeralLedger extends. Included for completeness/type-safety, not
  // because a guest session can ever actually reach it.
  function creditRewardClaim(accountId: string, amount: number, idempotencyKey: string): LedgerEntry {
    if (amount <= 0) throw new RangeError('Reward claim amount must be a positive integer');
    return writeEntry(accountId, null, 'REWARD_CLAIM', amount, idempotencyKey);
  }

  // Ticket 2026-09-24#1: exists solely to satisfy the `Ledger` interface EphemeralLedger
  // extends, same reason as creditRewardClaim above — a guest session's ledger is in-memory
  // and already bounded by `evict()` above (fired per-session on WS close/eviction grace
  // window expiry), not by a durable-disk-growth problem the real, SQLite-backed ledger has.
  // A genuine no-op: nothing here ever needs pruning the way `ledger_entry` on disk does.
  async function cleanupSettled(): Promise<{ matchesDeleted: number; rowsDeleted: number }> {
    return { matchesDeleted: 0, rowsDeleted: 0 };
  }

  // Ticket 2026-09-24#4: same reasoning as cleanupSettled above — a guest session's own
  // transaction history is already ephemeral and session-bounded (gone entirely on `evict()` or
  // process restart), never persisted to disk. There's no durable-disk-growth problem here for
  // compaction to solve; a genuine no-op.
  async function compactOldTransactions(): Promise<{ accountsCompacted: number; rowsDeleted: number }> {
    return { accountsCompacted: 0, rowsDeleted: 0 };
  }

  function evict(accountId: string): void {
    const list = entriesByAccount.get(accountId);
    if (!list) return;
    for (const e of list) {
      entryByIdempotencyKey.delete(e.idempotencyKey);
      if (e.matchId) {
        const matchList = entriesByMatch.get(e.matchId);
        if (matchList) {
          const filtered = matchList.filter((x) => x !== e);
          if (filtered.length > 0) entriesByMatch.set(e.matchId, filtered);
          else entriesByMatch.delete(e.matchId);
        }
      }
    }
    entriesByAccount.delete(accountId);
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
    evict,
  };
}
