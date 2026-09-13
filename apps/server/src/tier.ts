import type Database from 'better-sqlite3';
import { tierForXp } from '@rapidclash/core';
import type { VipTier } from '@rapidclash/shared';

/**
 * Read-only VIP-tier lookup for ANY playerId — extracted (ticket 2026-09-13#6 item 3) from
 * `ws/gateway.ts`'s own `resolveTier`, which originally backed chat only, so `createServices`
 * can hand the SAME resolver to the real `Matchmaking` instance's `lookupTier` option (feeding
 * the open-challenges feed's new `ownerTier` field) without a second, potentially-drifting copy
 * of this logic.
 *
 * Mirrors `match-history.ts`'s own `xpLifetimeStmt`/`tierFor` idiom exactly, for the same
 * reasons: `rewards` is owned/created lazily by `rewards.ts` and may not exist yet on every db
 * this is stood up against (tests, guest-only setups) — the prepare is wrapped, not bare. A
 * plain, read-only SELECT: a missing row (including every bot/guest id, which never has one)
 * simply reads as 0 XP, which `tierForXp` correctly maps to `'Unranked'`.
 */
export function createTierResolver(db: Database.Database): (playerId: string) => VipTier {
  let stmt: Database.Statement<[string], { xp_lifetime: number }> | null | undefined;
  return function resolveTier(playerId: string): VipTier {
    if (stmt === undefined) {
      try {
        stmt = db.prepare<[string], { xp_lifetime: number }>(
          `SELECT xp_lifetime FROM rewards WHERE account_id = ?`,
        );
      } catch {
        stmt = null; // no `rewards` table on this db — every lookup reads as 0 XP.
      }
    }
    const xpLifetime = stmt?.get(playerId)?.xp_lifetime ?? 0;
    return tierForXp(xpLifetime).tier;
  };
}
