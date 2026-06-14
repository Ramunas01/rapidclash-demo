import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createMatchHistory } from './match-history.js';

function freshDb() {
  return new Database(':memory:');
}

describe('createMatchHistory', () => {
  it('returns empty leaderboard when no matches have been recorded', () => {
    const mh = createMatchHistory(freshDb());
    expect(mh.getLeaderboard('rps')).toEqual([]);
  });

  it('ranks correctly after one win', () => {
    const mh = createMatchHistory(freshDb());
    mh.recordResult('m1', 'rps', ['alice', 'bob'], 'win', 'alice', 100);

    const board = mh.getLeaderboard('rps');
    expect(board).toHaveLength(2);

    const [first, second] = board;
    expect(first.playerId).toBe('alice');
    expect(first.rank).toBe(1);
    expect(first.gamesPlayed).toBe(1);
    expect(first.wins).toBe(1);
    expect(first.winRate).toBe(1);

    expect(second.playerId).toBe('bob');
    expect(second.rank).toBe(2);
    expect(second.gamesPlayed).toBe(1);
    expect(second.wins).toBe(0);
    expect(second.winRate).toBe(0);
  });

  it('shows 0 winRate for both players after a draw', () => {
    const mh = createMatchHistory(freshDb());
    mh.recordResult('m1', 'rps', ['alice', 'bob'], 'draw', undefined, 100);

    const board = mh.getLeaderboard('rps');
    expect(board).toHaveLength(2);
    expect(board.every((e) => e.wins === 0 && e.winRate === 0)).toBe(true);
    expect(board.every((e) => e.gamesPlayed === 1)).toBe(true);
  });

  it('returns empty leaderboard when the only match was void', () => {
    const mh = createMatchHistory(freshDb());
    mh.recordResult('m1', 'rps', ['alice', 'bob'], 'void', undefined, 100);
    expect(mh.getLeaderboard('rps')).toEqual([]);
  });

  it('recording the same matchId twice is idempotent', () => {
    const mh = createMatchHistory(freshDb());
    mh.recordResult('m1', 'rps', ['alice', 'bob'], 'win', 'alice', 100);
    mh.recordResult('m1', 'rps', ['alice', 'bob'], 'win', 'alice', 100); // duplicate

    const board = mh.getLeaderboard('rps');
    expect(board).toHaveLength(2);
    expect(board[0].wins).toBe(1);     // not 2
    expect(board[0].gamesPlayed).toBe(1); // not 2
  });

  it('sorts by winRate desc, tiebroken by gamesPlayed desc', () => {
    const mh = createMatchHistory(freshDb());

    // alice: 2W / 2GP = 1.0
    mh.recordResult('m1', 'rps', ['alice', 'bob'], 'win', 'alice', 100);
    mh.recordResult('m2', 'rps', ['alice', 'carol'], 'win', 'alice', 100);

    // bob: 1W / 2GP = 0.5  (wins m3, loses m1 already counted above)
    mh.recordResult('m3', 'rps', ['bob', 'carol'], 'win', 'bob', 100);

    // carol: 0W / 2GP = 0.0  (loses m2 and m3)

    const board = mh.getLeaderboard('rps');
    expect(board.map((e) => e.playerId)).toEqual(['alice', 'bob', 'carol']);
    expect(board[0].winRate).toBe(1);
    expect(board[0].gamesPlayed).toBe(2);
    expect(board[1].winRate).toBeCloseTo(0.5);
    expect(board[1].gamesPlayed).toBe(2);
    expect(board[2].winRate).toBe(0);
    expect(board[2].gamesPlayed).toBe(2);
  });

  it('isolates leaderboard by gameId', () => {
    const mh = createMatchHistory(freshDb());
    mh.recordResult('m1', 'rps', ['alice', 'bob'], 'win', 'alice', 100);
    mh.recordResult('m2', 'chess', ['carol', 'dave'], 'win', 'carol', 200);

    expect(mh.getLeaderboard('rps').map((e) => e.playerId)).not.toContain('carol');
    expect(mh.getLeaderboard('chess').map((e) => e.playerId)).not.toContain('alice');
  });
});
