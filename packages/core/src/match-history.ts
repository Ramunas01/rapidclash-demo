import type Database from 'better-sqlite3';
import type {
  AvatarId,
  EloLeaderboardEntry,
  LeaderboardEntry,
  NetWinningsLeaderboardEntry,
  RankingType,
  RecentMatchEntry,
  RecentMatchesResponse,
  VipTier,
  WinRateLeaderboardEntry,
} from '@rapidclash/shared';
import { PLATFORM_ACCOUNT } from './ledger.js';
import type { AvatarLookup, UsernameLookup } from './identity.js';
import { tierForXp } from './rewards.js';

/** Back-compat alias: a win_rate row used to be the only leaderboard shape. */
export type WinRateEntry = WinRateLeaderboardEntry;

/** ELO parameters (Advisor decision: fixed K, no tiered K, no Glicko). */
const START_RATING = 1500;
const ELO_K = 32;

export interface MatchHistory {
  recordResult(
    matchId: string,
    gameId: string,
    players: [string, string],
    outcome: 'win' | 'draw' | 'void',
    winnerId: string | undefined,
    stake: number,
  ): void;
  getLeaderboard(gameId: string): LeaderboardEntry[];
  /** The CALLING PLAYER's own recent match history, newest-settled-first (issue #400), backing
   *  `GET /matches/recent`. `limit`/`offset` are clamped server-side (see `getRecentMatches`'s
   *  implementation for the exact defaults/cap) — a caller passing an absurd `limit` cannot
   *  force a wasteful scan. */
  getRecentMatches(playerId: string, limit?: number, offset?: number): RecentMatchesResponse;
}

interface ResultRow {
  player1_id: string;
  player2_id: string;
  outcome: string;
  winner_id: string | null;
}

interface NetRow {
  account_id: string;
  net: number;
}

interface RecentRow {
  match_id: string;
  game_id: string;
  player1_id: string;
  player2_id: string;
  outcome: string;
  winner_id: string | null;
  settled_at: string;
}

/** getRecentMatches defaults/cap (issue #400): a reasonable page size for the Account screen's
 *  list, and a hard ceiling so a caller can't pass e.g. `?limit=1000000` and force a wasteful
 *  scan + N ledger-sum lookups per page. */
const RECENT_MATCHES_DEFAULT_LIMIT = 10;
const RECENT_MATCHES_MAX_LIMIT = 50;

/**
 * @param rankingByGame  gameId → declared RankingType, seeded from the game
 *   modules' `meta.ranking`. getLeaderboard dispatches GENERICALLY on the
 *   declared `kind` (ADR-007) — there is no per-game branching here. A gameId
 *   absent from the map falls back to `win_rate`, the historical default.
 */
export function createMatchHistory(
  db: Database.Database,
  rankingByGame: Map<string, RankingType> = new Map(),
  /** Shared playerId → username lookup (same one the open-challenge feed uses). When
   *  omitted, displayName falls back to the playerId — the historical placeholder. */
  lookupUsername?: UsernameLookup,
  /** Shared playerId → avatarId lookup (same seam as lookupUsername). When omitted, every entry
   *  falls back to `'default'`. The board is PUBLIC, so surfacing avatarId here is not a leak. */
  lookupAvatar?: AvatarLookup,
): MatchHistory {
  const displayNameFor = (playerId: string): string => lookupUsername?.(playerId) ?? playerId;
  const avatarFor = (playerId: string): AvatarId => lookupAvatar?.(playerId) ?? 'default';
  db.exec(`
    CREATE TABLE IF NOT EXISTS match_results (
      match_id   TEXT PRIMARY KEY,
      game_id    TEXT NOT NULL,
      player1_id TEXT NOT NULL,
      player2_id TEXT NOT NULL,
      outcome    TEXT NOT NULL,
      winner_id  TEXT,
      stake      INTEGER NOT NULL,
      settled_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mr_game ON match_results (game_id);
    CREATE INDEX IF NOT EXISTS idx_mr_p1 ON match_results (player1_id);
    CREATE INDEX IF NOT EXISTS idx_mr_p2 ON match_results (player2_id);
  `);

  const stmtInsert = db.prepare<
    [string, string, string, string, string, string | null, number, string]
  >(
    `INSERT OR IGNORE INTO match_results
       (match_id, game_id, player1_id, player2_id, outcome, winner_id, stake, settled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const stmtRows = db.prepare<[string], ResultRow>(
    `SELECT player1_id, player2_id, outcome, winner_id
     FROM match_results
     WHERE game_id = ?`,
  );

  // ELO is derived by replaying results in settlement order, so this query is
  // ordered chronologically. `rowid` (insertion order) is the deterministic
  // tiebreak for results that share a settled_at timestamp.
  const stmtRowsChrono = db.prepare<[string], ResultRow>(
    `SELECT player1_id, player2_id, outcome, winner_id
     FROM match_results
     WHERE game_id = ?
     ORDER BY settled_at ASC, rowid ASC`,
  );

  // net_winnings is derived from the LEDGER — the single source of money truth —
  // NOT from the match_results.stake column. For each player, sum their SIGNED
  // ledger amounts over entries whose match belongs to this game. That set is
  // exactly BET_ESCROW (already negative), SETTLE_WIN, and SETTLE_REFUND, so this
  // is ONE signed sum — do NOT add wins/refunds and subtract escrow again (escrow
  // is already negative; that would double-count). GRANT/ADMIN_CREDIT are excluded
  // automatically (null match_id); RAKE is excluded automatically (it lands on the
  // PLATFORM account, which never appears on a leaderboard). Across all players the
  // per-game sum is therefore −rake, i.e. a net-negative board, which is correct.
  //
  // Prepared lazily: `ledger_entry` is owned and created by the ledger, which a
  // win_rate-only consumer never instantiates. By the time a net_winnings board is
  // requested, a ledger (hence the table and its entries) necessarily exists.
  let stmtNet: Database.Statement<[string, string], NetRow> | undefined;
  function netStmt(): Database.Statement<[string, string], NetRow> {
    stmtNet ??= db.prepare<[string, string], NetRow>(
      `SELECT account_id, SUM(amount) AS net
       FROM ledger_entry
       WHERE match_id IN (SELECT match_id FROM match_results WHERE game_id = ?)
         AND account_id != ?
       GROUP BY account_id`,
    );
    return stmtNet;
  }

  // getRecentMatches (issue #400): rows where the player is EITHER side, newest-settled-first.
  // `void` matches are excluded at the SQL level — see RecentMatchEntry's doc comment
  // (packages/shared/src/protocol.ts) for why: a refund was never really "played" to a result,
  // so it has no meaningful win/loss/draw and its net delta is always 0 (escrow out, refund
  // back in) — showing it would just be a confusing zero-value row on the Account list.
  // `rowid` breaks ties deterministically for results sharing a settled_at timestamp, same
  // convention as stmtRowsChrono above.
  const stmtRecent = db.prepare<[string, string, number, number], RecentRow>(
    `SELECT match_id, game_id, player1_id, player2_id, outcome, winner_id, settled_at
     FROM match_results
     WHERE (player1_id = ? OR player2_id = ?) AND outcome != 'void'
     ORDER BY settled_at DESC, rowid DESC
     LIMIT ? OFFSET ?`,
  );

  const stmtRecentCount = db.prepare<[string, string], { cnt: number }>(
    `SELECT COUNT(*) AS cnt
     FROM match_results
     WHERE (player1_id = ? OR player2_id = ?) AND outcome != 'void'`,
  );

  // Per-match, per-player net delta — same signed-ledger-sum idea as netStmt() above, just
  // scoped to one match_id + one account_id instead of one game across all matches/players.
  // Prepared lazily for the same reason as netStmt: `ledger_entry` belongs to the ledger,
  // which a match-history-only consumer (e.g. some core unit tests) never instantiates.
  let stmtMatchNet: Database.Statement<[string, string], { net: number | null }> | undefined;
  function matchNetStmt(): Database.Statement<[string, string], { net: number | null }> {
    stmtMatchNet ??= db.prepare<[string, string], { net: number | null }>(
      `SELECT SUM(amount) AS net FROM ledger_entry WHERE match_id = ? AND account_id = ?`,
    );
    return stmtMatchNet;
  }

  // Opponent VIP tier for getRecentMatches (issue #440). `rewards` is owned and created by
  // rewards.ts — same "another module's table, reached lazily" idea as netStmt/matchNetStmt
  // above for `ledger_entry`, but UNLIKE ledger_entry, `rewards` is not guaranteed to exist by
  // the time this is called: every getRecentMatches test/consumer creates a ledger, but not
  // every one creates rewards too (and in the real server, createMatchHistory itself runs
  // BEFORE createRewards — see server.ts). So the prepare is wrapped, not bare: a
  // match-history-only consumer whose db has no `rewards` table falls back to 0 XP rather than
  // throwing, which `tierForXp` correctly maps to 'Unranked' anyway.
  let stmtXpLifetime: Database.Statement<[string], { xp_lifetime: number }> | null | undefined;
  function xpLifetimeStmt(): Database.Statement<[string], { xp_lifetime: number }> | null {
    if (stmtXpLifetime === undefined) {
      try {
        stmtXpLifetime = db.prepare<[string], { xp_lifetime: number }>(
          `SELECT xp_lifetime FROM rewards WHERE account_id = ?`,
        );
      } catch {
        stmtXpLifetime = null; // no `rewards` table in this db — every opponent reads as 0 XP.
      }
    }
    return stmtXpLifetime;
  }

  // Tier is derived AT QUERY TIME from current xp_lifetime, not stored/snapshotted at match
  // time — tiers only ever climb (tierForXp's doc comment), so "current tier" is always at
  // least as accurate as "tier when the match was played".
  function tierFor(playerId: string): VipTier {
    const xpLifetime = xpLifetimeStmt()?.get(playerId)?.xp_lifetime ?? 0;
    return tierForXp(xpLifetime).tier;
  }

  function recordResult(
    matchId: string,
    gameId: string,
    players: [string, string],
    outcome: 'win' | 'draw' | 'void',
    winnerId: string | undefined,
    stake: number,
  ): void {
    stmtInsert.run(
      matchId,
      gameId,
      players[0],
      players[1],
      outcome,
      winnerId ?? null,
      stake,
      new Date().toISOString(),
    );
  }

  function winRateLeaderboard(gameId: string): WinRateLeaderboardEntry[] {
    const rows = stmtRows.all(gameId);

    // Accumulate per-player stats from the result rows.
    const stats = new Map<string, { gamesPlayed: number; wins: number }>();

    function touch(pid: string): { gamesPlayed: number; wins: number } {
      if (!stats.has(pid)) stats.set(pid, { gamesPlayed: 0, wins: 0 });
      return stats.get(pid)!;
    }

    for (const row of rows) {
      const s1 = touch(row.player1_id);
      const s2 = touch(row.player2_id);

      if (row.outcome !== 'void') {
        s1.gamesPlayed++;
        s2.gamesPlayed++;
      }

      if (row.winner_id === row.player1_id) s1.wins++;
      else if (row.winner_id === row.player2_id) s2.wins++;
    }

    // Sort: winRate DESC, gamesPlayed DESC.
    const entries = [...stats.entries()].map(([playerId, s]) => ({
      playerId,
      gamesPlayed: s.gamesPlayed,
      wins: s.wins,
      winRate: s.gamesPlayed === 0 ? 0 : s.wins / s.gamesPlayed,
    }));

    const ranked = entries
      .filter((e) => e.gamesPlayed > 0)
      .sort((a, b) => {
        if (b.winRate !== a.winRate) return b.winRate - a.winRate;
        return b.gamesPlayed - a.gamesPlayed;
      });

    return ranked.map((e, i) => ({
      rank: i + 1,
      playerId: e.playerId,
      displayName: displayNameFor(e.playerId),
      avatarId: avatarFor(e.playerId),
      score: e.winRate,
      kind: 'win_rate',
      gamesPlayed: e.gamesPlayed,
      wins: e.wins,
      winRate: e.winRate,
    }));
  }

  function netWinningsLeaderboard(gameId: string): NetWinningsLeaderboardEntry[] {
    // Single signed sum per player, straight from the ledger (PLATFORM excluded).
    const rows = netStmt().all(gameId, PLATFORM_ACCOUNT);

    // Sort: net DESC, then playerId ASC for a deterministic tiebreak.
    const ranked = [...rows].sort((a, b) => {
      if (b.net !== a.net) return b.net - a.net;
      return a.account_id < b.account_id ? -1 : a.account_id > b.account_id ? 1 : 0;
    });

    return ranked.map((r, i) => ({
      rank: i + 1,
      playerId: r.account_id,
      displayName: displayNameFor(r.account_id),
      avatarId: avatarFor(r.account_id),
      score: r.net,
      kind: 'net_winnings',
      netWinnings: r.net,
    }));
  }

  function eloLeaderboard(gameId: string): EloLeaderboardEntry[] {
    // DERIVED-ON-QUERY (ADR-007, like win_rate/net_winnings): replay this game's
    // results in chronological order, applying the standard ELO update to both
    // players each time. No stored rating, no update-on-settle hook — the
    // ephemeral match_results store is the single source of truth.
    //
    // Fixed K=32 (Advisor decision); both players start at 1500. Ratings are kept
    // at full floating-point precision through the replay; the client rounds for
    // display (e.g. "1532 ELO"). void matches were never played and are skipped.
    const rows = stmtRowsChrono.all(gameId);

    const ratings = new Map<string, number>();
    const rating = (pid: string): number => ratings.get(pid) ?? START_RATING;

    for (const row of rows) {
      if (row.outcome === 'void') continue;
      const a = row.player1_id;
      const b = row.player2_id;
      const Ra = rating(a);
      const Rb = rating(b);
      // Expected scores (logistic; Ea + Eb === 1).
      const Ea = 1 / (1 + 10 ** ((Rb - Ra) / 400));
      const Eb = 1 - Ea;
      // Actual scores: win = 1/0, draw = 0.5/0.5.
      let Sa: number;
      let Sb: number;
      if (row.outcome === 'draw' || row.winner_id == null) {
        Sa = 0.5;
        Sb = 0.5;
      } else if (row.winner_id === a) {
        Sa = 1;
        Sb = 0;
      } else {
        Sa = 0;
        Sb = 1;
      }
      ratings.set(a, Ra + ELO_K * (Sa - Ea));
      ratings.set(b, Rb + ELO_K * (Sb - Eb));
    }

    // Sort: rating DESC, then playerId ASC for a deterministic tiebreak
    // (matches the net_winnings ordering convention).
    const ranked = [...ratings.entries()].sort((x, y) => {
      if (y[1] !== x[1]) return y[1] - x[1];
      return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0;
    });

    return ranked.map(([playerId, r], i) => ({
      rank: i + 1,
      playerId,
      displayName: displayNameFor(playerId),
      avatarId: avatarFor(playerId),
      score: r,
      kind: 'elo',
      rating: r,
    }));
  }

  function getLeaderboard(gameId: string): LeaderboardEntry[] {
    // Dispatch generically on the game's declared ranking kind (ADR-007).
    const kind = rankingByGame.get(gameId)?.kind ?? 'win_rate';
    switch (kind) {
      case 'win_rate':
        return winRateLeaderboard(gameId);
      case 'net_winnings':
        return netWinningsLeaderboard(gameId);
      case 'elo':
        return eloLeaderboard(gameId);
      default:
        // glicko is declared by the contract but not yet implemented (post-demo).
        throw new Error(`Unsupported ranking kind: ${kind}`);
    }
  }

  function getRecentMatches(
    playerId: string,
    limit: number = RECENT_MATCHES_DEFAULT_LIMIT,
    offset = 0,
  ): RecentMatchesResponse {
    // Clamp server-side — never trust the caller's raw limit/offset (issue #400: a huge limit
    // must not be able to force a wasteful scan + N ledger-sum lookups). NaN/non-finite input
    // (e.g. a malformed query param) falls back to the default/0 rather than producing NaN SQL
    // bind params.
    const safeLimit = Number.isFinite(limit) ? Math.floor(limit) : RECENT_MATCHES_DEFAULT_LIMIT;
    const safeOffset = Number.isFinite(offset) ? Math.floor(offset) : 0;
    const cappedLimit = Math.min(Math.max(safeLimit, 1), RECENT_MATCHES_MAX_LIMIT);
    const cappedOffset = Math.max(safeOffset, 0);

    const rows = stmtRecent.all(playerId, playerId, cappedLimit, cappedOffset);
    const total = stmtRecentCount.get(playerId, playerId)?.cnt ?? 0;

    const matches: RecentMatchEntry[] = rows.map((row) => {
      const opponentId = row.player1_id === playerId ? row.player2_id : row.player1_id;
      // Reframe the row's symmetric winner_id/outcome into the VIEWER's own perspective.
      // outcome here is never 'void' — excluded at the SQL level (see stmtRecent's comment).
      const outcome: 'win' | 'loss' | 'draw' =
        row.outcome === 'draw' ? 'draw' : row.winner_id === playerId ? 'win' : 'loss';
      const delta = matchNetStmt().get(row.match_id, playerId)?.net ?? 0;

      return {
        matchId: row.match_id,
        gameId: row.game_id,
        opponentId,
        opponentDisplayName: displayNameFor(opponentId),
        opponentAvatarId: avatarFor(opponentId),
        opponentTier: tierFor(opponentId),
        outcome,
        delta,
        settledAt: row.settled_at,
      };
    });

    return { matches, limit: cappedLimit, offset: cappedOffset, total };
  }

  return { recordResult, getLeaderboard, getRecentMatches };
}
