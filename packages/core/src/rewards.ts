import type Database from 'better-sqlite3';
import type { VipTier, RewardsSnapshot, RewardsClaimResponse } from '@rapidclash/shared';
import type { Ledger } from './ledger.js';

// ─── VIP tier ladder (issue #306) ──────────────────────────────────────────────
//
// Source of truth: the design file's `VIP_ROWS` const (design-ref/games-and-rewards/ —
// gitignored per WORKING_AGREEMENT.md, so the two rows this module depends on are
// transcribed here verbatim, per that doc's "transcribe every fact you rely on into a
// committed doc before the worktree disappears" rule):
//
//   VIP_ROWS[0] 'XP required' : ['500', '5,000', '25,000', '125,000', '475,000', '1,500,000']
//   VIP_ROWS[1] 'Rakeback'    : ['1%',  '4%',    '7%',     '10%',     '15%',     '20%']
//
// ...for tiers ['WOOD', 'BRONZE', 'SILVER', 'GOLD', 'EMERALD', 'DIAMOND'] respectively.
// Below WOOD's 500-XP threshold a player is 'Unranked' at 0% rakeback. Ordered high→low so
// `tierForXp` short-circuits on the first threshold cleared. Tiers never drop: pure function
// of `xp_lifetime`, which is monotonically non-decreasing — no separate guard needed.
export interface VipTierRow {
  tier: VipTier;
  xpRequired: number;
  rakebackRate: number;
}

const VIP_ROWS: readonly VipTierRow[] = [
  { tier: 'Diamond', xpRequired: 1_500_000, rakebackRate: 0.2 },
  { tier: 'Emerald', xpRequired: 475_000, rakebackRate: 0.15 },
  { tier: 'Gold', xpRequired: 125_000, rakebackRate: 0.1 },
  { tier: 'Silver', xpRequired: 25_000, rakebackRate: 0.07 },
  { tier: 'Bronze', xpRequired: 5_000, rakebackRate: 0.04 },
  { tier: 'Wood', xpRequired: 500, rakebackRate: 0.01 },
];

const UNRANKED: VipTierRow = { tier: 'Unranked', xpRequired: 0, rakebackRate: 0 };

/** Pure derivation of VIP tier from lifetime XP — never stored as mutable state (same pattern
 *  as this repo's `net_winnings` derivation, ADR-007). Exported for the frontend ticket (#307)
 *  and for tests. */
export function tierForXp(xpLifetime: number): VipTierRow {
  for (const row of VIP_ROWS) {
    if (xpLifetime >= row.xpRequired) return row;
  }
  return UNRANKED;
}

/** The tier row immediately above `tier`, or undefined at the top (Diamond) / for Unranked
 *  reaching Wood. Ordered list above is high→low, so "next" is the previous array entry. */
function nextTierAfter(tier: VipTier): VipTierRow | undefined {
  if (tier === 'Unranked') return VIP_ROWS[VIP_ROWS.length - 1]; // → Wood
  const idx = VIP_ROWS.findIndex((r) => r.tier === tier);
  return idx > 0 ? VIP_ROWS[idx - 1] : undefined; // Diamond (idx 0) has no next
}

// ─── Monthly volume bonus (issue #306) ─────────────────────────────────────────
//
// Source: design file's `vbRows2` data (transcribed in the spec doc, cross-checked against
// the decoded template): only Emerald/Diamond tiers qualify; only the HIGHEST threshold
// cleared pays (not cumulative); below Emerald, no bonus.
function volumeBonusRate(tier: VipTier, monthlyXp: number): number {
  if (tier === 'Diamond') {
    if (monthlyXp >= 300_000) return 0.08;
    if (monthlyXp >= 120_000) return 0.05;
    return 0;
  }
  if (tier === 'Emerald') {
    if (monthlyXp >= 120_000) return 0.05;
    if (monthlyXp >= 50_000) return 0.03;
    return 0;
  }
  return 0;
}

// ─── Row shape ──────────────────────────────────────────────────────────────────

interface RewardsRow {
  account_id: string;
  xp_lifetime: number;
  xp_monthly: number;
  xp_monthly_reset_at: string;
  wagered_lifetime: number;
  claimable_balance: number;
  /** Sum of this account's own `notionalRake` contributions for the CURRENT open month
   *  (issue #306's "thatMonth'sPlayerNotionalRakeSum") — not part of the issue's literal
   *  5-column schema list, but required to compute the volume bonus at month-close: the
   *  loser's half of a match's rake never lands a ledger RAKE entry (only the winner's does,
   *  ledger.ts settle()), so there is no way to reconstruct a per-player monthly notional-rake
   *  sum from the ledger after the fact. Flagged here and in the PR description per the
   *  dispatch's "flag it clearly rather than guessing" instruction — this is an intentional,
   *  documented addition, not an oversight. REAL (not INTEGER): notionalRake is fractional
   *  (stake × feeRate arithmetic); only the final bonus credit is rounded to whole RC. */
  notional_rake_monthly: number;
  /** Monotonic per-account counter, incremented on every actually-processed claim.
   *  Used to derive a deterministic, never-reused ledger idempotency key per claim
   *  (`reward_claim:<accountId>:<seq>`) — see `claim()`. */
  claim_seq: number;
}

export interface Rewards {
  /** Called once per player, per real match settlement (win, draw, OR void) — wired to
   *  `Matchmaking`'s `onPlayerSettled` hook, which itself only fires once per match (reuses
   *  `settleMatch`'s existing `completed.get(matchId)` idempotency guard — issue #306 asked
   *  for exactly this, no second guard here). `wagered_lifetime` accrues on every outcome (the
   *  player DID stake that amount regardless of result); XP + rakeback accrue ONLY on a
   *  decisive `'win'` — for BOTH the winner and the loser, each computed independently from
   *  their OWN stake (never by splitting the single ledger RAKE entry, which only exists once,
   *  on the winner's side). */
  recordMatchSettlement(
    playerId: string,
    stake: number,
    feeRate: number,
    outcome: 'win' | 'draw' | 'void',
  ): void;
  /** Current derived snapshot for the Rewards page (issue #307's data source). Lazily closes
   *  any elapsed month for this account first, so a balance read right after a month-turn
   *  reflects a just-earned volume bonus even before the next scheduled sweep tick. */
  getSnapshot(playerId: string): RewardsSnapshot;
  /** Atomically moves the WHOLE `claimable_balance` into the wallet as one `REWARD_CLAIM`
   *  ledger entry, zeroing `claimable_balance` in the same transaction. Idempotent by
   *  construction: a double-tap / retried call that lands after the balance is already zero
   *  finds nothing to claim and returns `{ credited: 0, newClaimableBalance: 0 }` — no ledger
   *  write, no error. (better-sqlite3 transactions run synchronously to completion on Node's
   *  single thread, so two "concurrent" HTTP requests can never interleave inside this
   *  transaction either.) */
  claim(playerId: string): RewardsClaimResponse;
  /** Sweep every account whose stored month has closed (`xp_monthly_reset_at` predates the
   *  current UTC month): credit any earned volume bonus into `claimable_balance` and reset the
   *  monthly counters. Safe to call redundantly/on a schedule/concurrently with per-account
   *  lazy closes — a closed month is only ever processed once, guarded by comparing the stored
   *  reset marker to the current month start. Exposed for the server's periodic sweep (no
   *  existing cron in this repo — see apps/server/src/index.ts) so a DORMANT account (one that
   *  never plays again) still gets its bonus "in the first days of the new month" per spec,
   *  not only on its own next match. */
  closeElapsedMonths(nowMs?: number): void;
}

function startOfMonthUtcIso(nowMs: number): string {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

export function createRewards(
  db: Database.Database,
  ledger: Ledger,
  nowFn: () => number = () => Date.now(),
): Rewards {
  // New table, not an ALTER TABLE on `accounts` (identity.ts's snapshot-safe pattern is for
  // adding a column to an EXISTING table an old snapshot predates — a brand-new table has no
  // such predecessor, so `CREATE TABLE IF NOT EXISTS` alone is already snapshot-safe: an old
  // restored snapshot simply won't have this table yet, and this statement creates it fresh
  // with every account starting at all-zero defaults, same end state as a real migration).
  // Keyed by account id in its OWN table (not `accounts`) — mirrors how `ledger.ts` and
  // `identity.ts` each own a single table rather than accreting columns onto one shared table.
  db.exec(`
    CREATE TABLE IF NOT EXISTS rewards (
      account_id            TEXT PRIMARY KEY,
      xp_lifetime            INTEGER NOT NULL DEFAULT 0,
      xp_monthly              INTEGER NOT NULL DEFAULT 0,
      xp_monthly_reset_at     TEXT NOT NULL,
      wagered_lifetime        INTEGER NOT NULL DEFAULT 0,
      claimable_balance       INTEGER NOT NULL DEFAULT 0,
      notional_rake_monthly   REAL NOT NULL DEFAULT 0,
      claim_seq                INTEGER NOT NULL DEFAULT 0
    )
  `);

  const stmtInsertIfMissing = db.prepare<[string, string]>(
    `INSERT OR IGNORE INTO rewards (account_id, xp_monthly_reset_at) VALUES (?, ?)`,
  );

  const stmtGetRow = db.prepare<[string], RewardsRow>(`SELECT * FROM rewards WHERE account_id = ?`);

  const stmtGetStaleAccounts = db.prepare<[string], { account_id: string }>(
    `SELECT account_id FROM rewards WHERE xp_monthly_reset_at != ?`,
  );

  const stmtCloseMonth = db.prepare<[number, string, string, string]>(
    `UPDATE rewards
     SET claimable_balance = claimable_balance + ?,
         xp_monthly = 0,
         notional_rake_monthly = 0,
         xp_monthly_reset_at = ?
     WHERE account_id = ? AND xp_monthly_reset_at != ?`,
  );

  const stmtAccrue = db.prepare<[number, number, number, number, number, string]>(
    `UPDATE rewards
     SET xp_lifetime = xp_lifetime + ?,
         xp_monthly = xp_monthly + ?,
         notional_rake_monthly = notional_rake_monthly + ?,
         wagered_lifetime = wagered_lifetime + ?,
         claimable_balance = claimable_balance + ?
     WHERE account_id = ?`,
  );

  const stmtClaim = db.prepare<[number, string]>(
    `UPDATE rewards SET claimable_balance = 0, claim_seq = ? WHERE account_id = ?`,
  );

  function ensureRow(accountId: string, nowMs: number): void {
    stmtInsertIfMissing.run(accountId, startOfMonthUtcIso(nowMs));
  }

  /** Close ONE account's elapsed month, inside a single atomic transaction. A no-op (0 rows
   *  affected) if the account's stored month already matches `currentMonthStart` — including
   *  the race where a concurrent call already closed it, since the UPDATE's own WHERE clause
   *  re-checks the marker. */
  function closeAccountMonth(accountId: string, currentMonthStart: string): void {
    const txn = db.transaction(() => {
      const row = stmtGetRow.get(accountId);
      if (!row || row.xp_monthly_reset_at === currentMonthStart) return;

      const tier = tierForXp(row.xp_lifetime).tier;
      const rate = volumeBonusRate(tier, row.xp_monthly);
      const bonus = rate > 0 ? Math.round(row.notional_rake_monthly * rate) : 0;

      stmtCloseMonth.run(bonus, currentMonthStart, accountId, currentMonthStart);
    });
    txn();
  }

  function closeElapsedMonths(nowMs: number = nowFn()): void {
    const currentMonthStart = startOfMonthUtcIso(nowMs);
    const stale = stmtGetStaleAccounts.all(currentMonthStart);
    for (const { account_id } of stale) {
      closeAccountMonth(account_id, currentMonthStart);
    }
  }

  function recordMatchSettlement(
    playerId: string,
    stake: number,
    feeRate: number,
    outcome: 'win' | 'draw' | 'void',
  ): void {
    const nowMs = nowFn();
    ensureRow(playerId, nowMs);
    closeAccountMonth(playerId, startOfMonthUtcIso(nowMs));

    const txn = db.transaction(() => {
      const row = stmtGetRow.get(playerId)!;

      // Tier rate read BEFORE this match's XP is added — "never retroactive": a tier-up
      // caused by THIS match's XP must not apply its new (higher) rakeback rate to the
      // same match that caused the crossing.
      const rakebackRate = tierForXp(row.xp_lifetime).rakebackRate;

      let notionalRake = 0;
      let xpGained = 0;
      let rakebackGained = 0;
      if (outcome === 'win') {
        // Diminishing return is XP/volume-bonus-only — rakeback below is undiminished.
        notionalRake = Math.min(stake, 100) * feeRate + Math.max(stake - 100, 0) * feeRate * 0.25;
        xpGained = Math.round(40 * notionalRake);
        rakebackGained = Math.round(stake * feeRate * rakebackRate);
      }

      stmtAccrue.run(xpGained, xpGained, notionalRake, stake, rakebackGained, playerId);
    });
    txn();
  }

  function getSnapshot(playerId: string): RewardsSnapshot {
    const nowMs = nowFn();
    ensureRow(playerId, nowMs);
    closeAccountMonth(playerId, startOfMonthUtcIso(nowMs));

    const row = stmtGetRow.get(playerId)!;
    const current = tierForXp(row.xp_lifetime);
    return {
      xpLifetime: row.xp_lifetime,
      xpMonthly: row.xp_monthly,
      wageredLifetime: row.wagered_lifetime,
      claimableBalance: row.claimable_balance,
      tier: current.tier,
      rakebackRate: current.rakebackRate,
      nextTier: nextTierAfter(current.tier),
    };
  }

  function claim(playerId: string): RewardsClaimResponse {
    const nowMs = nowFn();
    ensureRow(playerId, nowMs);
    closeAccountMonth(playerId, startOfMonthUtcIso(nowMs));

    let credited = 0;
    const txn = db.transaction(() => {
      const row = stmtGetRow.get(playerId)!;
      if (row.claimable_balance <= 0) return; // nothing to claim — idempotent no-op

      credited = row.claimable_balance;
      const newSeq = row.claim_seq + 1;
      // Deterministic, server-generated, never-reused key — a genuine double-tap never gets
      // here twice (the balance-already-zero check above short-circuits it first), but the
      // ledger's own UNIQUE constraint is defense-in-depth against a duplicate call landing
      // between the SELECT and the UPDATE below in some future, less-synchronous DB driver.
      stmtClaim.run(newSeq, playerId);
      ledger.creditRewardClaim(playerId, credited, `reward_claim:${playerId}:${newSeq}`);
    });
    txn();

    return { credited, newClaimableBalance: 0 };
  }

  return { recordMatchSettlement, getSnapshot, claim, closeElapsedMonths };
}
