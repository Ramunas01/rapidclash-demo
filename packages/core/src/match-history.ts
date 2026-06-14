import type Database from 'better-sqlite3';

export interface WinRateEntry {
  rank: number;
  playerId: string;
  /** Placeholder until identity exposes username lookup. */
  displayName: string;
  gamesPlayed: number;
  wins: number;
  winRate: number;
}

export interface MatchHistory {
  recordResult(
    matchId: string,
    gameId: string,
    players: [string, string],
    outcome: 'win' | 'draw' | 'void',
    winnerId: string | undefined,
    stake: number,
  ): void;
  getLeaderboard(gameId: string): WinRateEntry[];
}

interface ResultRow {
  player1_id: string;
  player2_id: string;
  outcome: string;
  winner_id: string | null;
}

export function createMatchHistory(db: Database.Database): MatchHistory {
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

  function getLeaderboard(gameId: string): WinRateEntry[] {
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
      displayName: e.playerId,
      gamesPlayed: e.gamesPlayed,
      wins: e.wins,
      winRate: e.winRate,
    }));
  }

  return { recordResult, getLeaderboard };
}
