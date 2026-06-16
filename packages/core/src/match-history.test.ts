import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import type { RankingType } from '@rapidclash/shared';
import { createMatchHistory, type WinRateEntry } from './match-history.js';
import { createLedger, PLATFORM_ACCOUNT } from './ledger.js';

function freshDb() {
  return new Database(':memory:');
}

const RPS_WIN_RATE: RankingType = { kind: 'win_rate' };
const COINFLIP_NET: RankingType = { kind: 'net_winnings' };
const CHESS_ELO: RankingType = { kind: 'elo', k: 32 };

/** getLeaderboard now returns the generalized union; these legacy win_rate
 *  assertions narrow to the win_rate row shape (runtime output is unchanged). */
function winRateBoard(mh: ReturnType<typeof createMatchHistory>, gameId: string): WinRateEntry[] {
  return mh.getLeaderboard(gameId) as WinRateEntry[];
}

describe('createMatchHistory', () => {
  it('returns empty leaderboard when no matches have been recorded', () => {
    const mh = createMatchHistory(freshDb());
    expect(mh.getLeaderboard('rps')).toEqual([]);
  });

  it('ranks correctly after one win', () => {
    const mh = createMatchHistory(freshDb());
    mh.recordResult('m1', 'rps', ['alice', 'bob'], 'win', 'alice', 100);

    const board = winRateBoard(mh, 'rps');
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

    const board = winRateBoard(mh, 'rps');
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

    const board = winRateBoard(mh, 'rps');
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

    const board = winRateBoard(mh, 'rps');
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

  it('resolves displayName via the shared username lookup (#40), playerId as fallback', () => {
    // The same lookup the open-challenge feed uses, injected here (server shares one).
    const lookup = (id: string) => (id === 'alice-id' ? 'Alice' : undefined);
    const mh = createMatchHistory(freshDb(), new Map(), lookup);
    mh.recordResult('m1', 'rps', ['alice-id', 'bob-id'], 'win', 'alice-id', 100);

    const board = winRateBoard(mh, 'rps');
    const byId = Object.fromEntries(board.map((e) => [e.playerId, e.displayName]));
    expect(byId['alice-id']).toBe('Alice'); // resolved
    expect(byId['bob-id']).toBe('bob-id'); // unknown → playerId placeholder
  });

  it('tags win_rate rows with kind and exposes score = winRate (generalized shape)', () => {
    const mh = createMatchHistory(freshDb(), new Map([['rps', RPS_WIN_RATE]]));
    mh.recordResult('m1', 'rps', ['alice', 'bob'], 'win', 'alice', 100);

    const [first] = mh.getLeaderboard('rps');
    expect(first.kind).toBe('win_rate');
    expect(first.score).toBe(first.kind === 'win_rate' ? first.winRate : NaN);
    expect(first.score).toBe(1);
  });
});

// ─── net_winnings (ADR-007) ─────────────────────────────────────────────────
// net_winnings is derived from the LEDGER as a single signed sum, not from a
// stake column. These tests share one db between the ledger and match history.

/** Play one fully-settled match end to end through the real ledger:
 *  both players escrow `stake`, the winner is paid pot−rake, PLATFORM takes rake. */
function playMatch(
  ledger: ReturnType<typeof createLedger>,
  mh: ReturnType<typeof createMatchHistory>,
  matchId: string,
  gameId: string,
  players: [string, string],
  winner: string,
  stake: number,
  feeRate = 0.05,
) {
  for (const p of players) ledger.escrow(p, matchId, stake);
  ledger.settle(matchId, 'win', winner, stake * 2, feeRate);
  mh.recordResult(matchId, gameId, players, 'win', winner, stake);
}

describe('createMatchHistory — net_winnings leaderboard', () => {
  function setup() {
    const db = freshDb();
    const ledger = createLedger(db);
    const mh = createMatchHistory(
      db,
      new Map([
        ['rps', RPS_WIN_RATE],
        ['coinflip', COINFLIP_NET],
      ]),
    );
    ledger.grant('alice');
    ledger.grant('bob');
    return { db, ledger, mh };
  }

  it('dispatches: rps → win_rate, coinflip → net_winnings', () => {
    const { ledger, mh } = setup();
    mh.recordResult('r1', 'rps', ['alice', 'bob'], 'win', 'alice', 100);
    playMatch(ledger, mh, 'c1', 'coinflip', ['alice', 'bob'], 'alice', 100);

    expect(mh.getLeaderboard('rps').every((e) => e.kind === 'win_rate')).toBe(true);
    expect(mh.getLeaderboard('coinflip').every((e) => e.kind === 'net_winnings')).toBe(true);
  });

  it('computes each player net as a single signed ledger sum', () => {
    const { ledger, mh } = setup();
    // alice wins a 100-stake coinflip. pot=200, rake=round(200*0.05)=10.
    // alice: −100 escrow + 190 win = +90.  bob: −100 escrow = −100.
    playMatch(ledger, mh, 'c1', 'coinflip', ['alice', 'bob'], 'alice', 100);

    const board = mh.getLeaderboard('coinflip');
    const byId = Object.fromEntries(board.map((e) => [e.playerId, e]));
    expect(byId['alice'].score).toBe(90);
    expect(byId['bob'].score).toBe(-100);
    // The net_winnings detail field mirrors the score.
    expect(board.every((e) => e.kind === 'net_winnings' && e.netWinnings === e.score)).toBe(true);
    // Sorted by net DESC and ranked 1..n.
    expect(board.map((e) => e.playerId)).toEqual(['alice', 'bob']);
    expect(board.map((e) => e.rank)).toEqual([1, 2]);
  });

  it('excludes the PLATFORM account even though RAKE lands there', () => {
    const { mh, ledger } = setup();
    playMatch(ledger, mh, 'c1', 'coinflip', ['alice', 'bob'], 'alice', 100);

    const board = mh.getLeaderboard('coinflip');
    expect(board.map((e) => e.playerId)).not.toContain(PLATFORM_ACCOUNT);
  });

  it('rake makes the player-sum net NEGATIVE across players (correct, not a bug)', () => {
    const { ledger, mh } = setup();
    // Two settled coinflips, each rake=10 → total rake 20 leaves the players.
    playMatch(ledger, mh, 'c1', 'coinflip', ['alice', 'bob'], 'alice', 100);
    playMatch(ledger, mh, 'c2', 'coinflip', ['alice', 'bob'], 'bob', 100);

    const board = mh.getLeaderboard('coinflip');
    const total = board.reduce((acc, e) => acc + e.score, 0);
    expect(total).toBe(-20); // = −(rake of both matches); PLATFORM holds the +20
    expect(total).toBeLessThan(0);
  });

  it('excludes GRANT/ADMIN_CREDIT (null match_id) — only match-scoped entries count', () => {
    const { ledger, mh } = setup();
    ledger.adminCredit('alice', 500, 'credit:alice:1'); // null match_id, must not appear
    playMatch(ledger, mh, 'c1', 'coinflip', ['alice', 'bob'], 'alice', 100);

    const alice = mh.getLeaderboard('coinflip').find((e) => e.playerId === 'alice')!;
    // Still +90 from the match alone; the 1000 grant + 500 credit are excluded.
    expect(alice.score).toBe(90);
  });

  it('a void match nets zero (escrow then full refund)', () => {
    const { ledger, mh } = setup();
    ledger.escrow('alice', 'c1', 100);
    ledger.escrow('bob', 'c1', 100);
    ledger.settle('c1', 'void', undefined, 200, 0.05); // refunds each stake, no rake
    mh.recordResult('c1', 'coinflip', ['alice', 'bob'], 'void', undefined, 100);

    const board = mh.getLeaderboard('coinflip');
    expect(board.every((e) => e.score === 0)).toBe(true);
  });
});

// ─── elo (ADR-007, additive) ────────────────────────────────────────────────
// ELO is DERIVED-ON-QUERY: replay the game's results in chronological order,
// applying the standard update (start 1500, K=32) to both players each result.
// No stored rating, no persistence beyond the existing match_results store.

describe('createMatchHistory — elo leaderboard', () => {
  function eloMh() {
    return createMatchHistory(freshDb(), new Map([['chess', CHESS_ELO]]));
  }

  /** Narrow the union to the elo row shape for assertions. */
  function eloBoard(mh: ReturnType<typeof createMatchHistory>) {
    return mh.getLeaderboard('chess') as Array<{
      rank: number;
      playerId: string;
      score: number;
      kind: 'elo';
      rating: number;
    }>;
  }

  it('dispatches chess → elo and tags rows with kind/score = rating', () => {
    const mh = eloMh();
    mh.recordResult('m1', 'chess', ['alice', 'bob'], 'win', 'alice', 100);

    const board = eloBoard(mh);
    expect(board.every((e) => e.kind === 'elo' && e.score === e.rating)).toBe(true);
  });

  it('a single win from 1500/1500 with K=32 yields exactly 1516 / 1484', () => {
    // Hand-computed: Ea = 1/(1+10^0) = 0.5.
    //   winner: 1500 + 32*(1 − 0.5) = 1516
    //   loser:  1500 + 32*(0 − 0.5) = 1484
    const mh = eloMh();
    mh.recordResult('m1', 'chess', ['alice', 'bob'], 'win', 'alice', 100);

    const board = eloBoard(mh);
    const byId = Object.fromEntries(board.map((e) => [e.playerId, e]));
    expect(byId['alice'].rating).toBe(1516);
    expect(byId['bob'].rating).toBe(1484);
    // Ranked by rating DESC.
    expect(board.map((e) => e.playerId)).toEqual(['alice', 'bob']);
    expect(board.map((e) => e.rank)).toEqual([1, 2]);
  });

  it('a draw between unequally-rated players moves their ratings toward each other', () => {
    const mh = eloMh();
    // First make them unequal: alice 1516, bob 1484 (gap 32).
    mh.recordResult('m1', 'chess', ['alice', 'bob'], 'win', 'alice', 100);
    // Then a draw. Hand-computed from 1516/1484:
    //   Ea = 1/(1+10^(-32/400)) ≈ 0.545922
    //   alice: 1516 + 32*(0.5 − 0.545922) ≈ 1514.53  (down)
    //   bob:   1484 + 32*(0.5 − 0.454078) ≈ 1485.47  (up)
    mh.recordResult('m2', 'chess', ['alice', 'bob'], 'draw', undefined, 100);

    const board = eloBoard(mh);
    const byId = Object.fromEntries(board.map((e) => [e.playerId, e]));
    expect(byId['alice'].rating).toBeCloseTo(1514.53, 2);
    expect(byId['bob'].rating).toBeCloseTo(1485.47, 2);
    // Moved toward each other: higher came down, lower came up, gap shrank < 32.
    expect(byId['alice'].rating).toBeLessThan(1516);
    expect(byId['bob'].rating).toBeGreaterThan(1484);
    expect(byId['alice'].rating - byId['bob'].rating).toBeLessThan(32);
    // Order preserved: alice still ahead.
    expect(board.map((e) => e.playerId)).toEqual(['alice', 'bob']);
  });

  it('replays a fixed multi-match sequence into the correct order and ratings', () => {
    const mh = eloMh();
    mh.recordResult('m1', 'chess', ['alice', 'bob'], 'win', 'alice', 100); // alice 1516, bob 1484
    mh.recordResult('m2', 'chess', ['bob', 'carol'], 'win', 'bob', 100); // bob 1500.74, carol 1483.26

    const board = eloBoard(mh);
    const byId = Object.fromEntries(board.map((e) => [e.playerId, e]));
    expect(byId['alice'].rating).toBe(1516);
    expect(byId['bob'].rating).toBeCloseTo(1500.74, 2);
    expect(byId['carol'].rating).toBeCloseTo(1483.26, 2);
    expect(board.map((e) => e.playerId)).toEqual(['alice', 'bob', 'carol']);
    expect(board.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it('ELO is zero-sum: total rating is conserved at n × 1500', () => {
    const mh = eloMh();
    mh.recordResult('m1', 'chess', ['alice', 'bob'], 'win', 'alice', 100);
    mh.recordResult('m2', 'chess', ['bob', 'carol'], 'win', 'bob', 100);
    mh.recordResult('m3', 'chess', ['carol', 'alice'], 'draw', undefined, 100);

    const board = eloBoard(mh);
    const total = board.reduce((acc, e) => acc + e.rating, 0);
    expect(total).toBeCloseTo(3 * 1500, 6); // three players, perfectly conserved
  });

  it('a void-only match yields an empty board (never played — like win_rate)', () => {
    const mh = eloMh();
    mh.recordResult('m1', 'chess', ['alice', 'bob'], 'void', undefined, 100);
    expect(mh.getLeaderboard('chess')).toEqual([]);
  });

  it('void matches are skipped but real ones still count (player keeps 1500 baseline)', () => {
    const mh = eloMh();
    // A void between alice & bob changes nothing; then alice actually beats bob.
    mh.recordResult('m1', 'chess', ['alice', 'bob'], 'void', undefined, 100);
    mh.recordResult('m2', 'chess', ['alice', 'bob'], 'win', 'alice', 100);

    const board = eloBoard(mh);
    const byId = Object.fromEntries(board.map((e) => [e.playerId, e.rating]));
    // Identical to a single win from the 1500 baseline — the void had no effect.
    expect(byId['alice']).toBe(1516);
    expect(byId['bob']).toBe(1484);
  });

  it('rejects glicko (declared but unimplemented, post-demo)', () => {
    const mh = createMatchHistory(freshDb(), new Map([['x', { kind: 'glicko' }]]));
    expect(() => mh.getLeaderboard('x')).toThrow(/Unsupported ranking kind/);
  });
});
