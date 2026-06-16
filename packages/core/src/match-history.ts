import type Database from 'better-sqlite3';
import type {
  EloLeaderboardEntry,
  LeaderboardEntry,
  NetWinningsLeaderboardEntry,
  RankingType,
  WinRateLeaderboardEntry,
} from '@rapidclash/shared';
import { PLATFORM_ACCOUNT } from './ledger.js';
import type { UsernameLookup } from './identity.js';

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
): MatchHistory {
  const displayNameFor = (playerId: string): string => lookupUsername?.(playerId) ?? playerId;
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

  return { recordResult, getLeaderboard };
}
