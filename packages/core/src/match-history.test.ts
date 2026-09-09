import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import type { RankingType } from '@rapidclash/shared';
import { createMatchHistory, type WinRateEntry } from './match-history.js';
import { createLedger, PLATFORM_ACCOUNT } from './ledger.js';
import { createRewards } from './rewards.js';

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

  it('resolves each entry\'s avatarId via the shared avatar lookup, "default" as fallback', () => {
    const lookup = (id: string) => (id === 'alice-id' ? 'Alice' : undefined);
    const avatar = (id: string) => (id === 'alice-id' ? ('boy-light' as const) : ('default' as const));
    const mh = createMatchHistory(freshDb(), new Map(), lookup, avatar);
    mh.recordResult('m1', 'rps', ['alice-id', 'bob-id'], 'win', 'alice-id', 100);

    const board = winRateBoard(mh, 'rps');
    const byId = Object.fromEntries(board.map((e) => [e.playerId, e.avatarId]));
    expect(byId['alice-id']).toBe('boy-light'); // resolved
    expect(byId['bob-id']).toBe('default'); // unknown → default
  });

  it('defaults avatarId to "default" when no avatar lookup is injected', () => {
    const mh = createMatchHistory(freshDb());
    mh.recordResult('m1', 'rps', ['alice', 'bob'], 'win', 'alice', 100);
    const board = winRateBoard(mh, 'rps');
    expect(board.every((e) => e.avatarId === 'default')).toBe(true);
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

// ─── getRecentMatches (issue #400) ─────────────────────────────────────────
// Backs GET /matches/recent — the calling player's own recent history, opponent +
// viewer-perspective outcome + net ledger delta, newest-settled-first, paginated.

describe('createMatchHistory — getRecentMatches', () => {
  function setup() {
    const db = freshDb();
    const ledger = createLedger(db);
    const mh = createMatchHistory(db, new Map([['rps', RPS_WIN_RATE]]));
    ledger.grant('alice');
    ledger.grant('bob');
    ledger.grant('carol');
    return { db, ledger, mh };
  }

  it('returns an empty page with total 0 when the player has no matches', () => {
    const { mh } = setup();
    const res = mh.getRecentMatches('alice');
    expect(res).toEqual({ matches: [], limit: 10, offset: 0, total: 0 });
  });

  it('only ever returns matches the player was actually in, never another player\'s', () => {
    const { ledger, mh } = setup();
    playMatch(ledger, mh, 'm1', 'rps', ['alice', 'bob'], 'alice', 100);
    playMatch(ledger, mh, 'm2', 'rps', ['bob', 'carol'], 'carol', 100); // alice not involved

    const res = mh.getRecentMatches('alice');
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0].matchId).toBe('m1');
    expect(res.total).toBe(1);
  });

  it('reports the opponent (not the viewer) regardless of which side the viewer was on', () => {
    const { ledger, mh } = setup();
    playMatch(ledger, mh, 'm1', 'rps', ['alice', 'bob'], 'alice', 100); // alice is player1
    playMatch(ledger, mh, 'm2', 'rps', ['carol', 'alice'], 'carol', 100); // alice is player2

    const res = mh.getRecentMatches('alice');
    const byId = Object.fromEntries(res.matches.map((m) => [m.matchId, m.opponentId]));
    expect(byId['m1']).toBe('bob');
    expect(byId['m2']).toBe('carol');
  });

  it('resolves opponent displayName/avatarId via the shared lookups (same seam as the leaderboard)', () => {
    const db = freshDb();
    const ledger = createLedger(db);
    const lookupName = (id: string) => (id === 'bob' ? 'Bobby' : undefined);
    const lookupAvatar = (id: string) => (id === 'bob' ? ('boy-light' as const) : ('default' as const));
    const mh = createMatchHistory(db, new Map([['rps', RPS_WIN_RATE]]), lookupName, lookupAvatar);
    ledger.grant('alice');
    ledger.grant('bob');
    playMatch(ledger, mh, 'm1', 'rps', ['alice', 'bob'], 'alice', 100);

    const [row] = mh.getRecentMatches('alice').matches;
    expect(row.opponentDisplayName).toBe('Bobby');
    expect(row.opponentAvatarId).toBe('boy-light');
  });

  it('reframes outcome from the viewer\'s own perspective: win, loss, and draw', () => {
    const { ledger, mh } = setup();
    playMatch(ledger, mh, 'm1', 'rps', ['alice', 'bob'], 'alice', 100); // alice won
    playMatch(ledger, mh, 'm2', 'rps', ['carol', 'alice'], 'carol', 100); // alice lost
    for (const p of ['alice', 'bob'] as const) ledger.escrow(p, 'm3', 100);
    ledger.settle('m3', 'draw', undefined, 200, 0.05);
    mh.recordResult('m3', 'rps', ['alice', 'bob'], 'draw', undefined, 100);

    const res = mh.getRecentMatches('alice');
    const byId = Object.fromEntries(res.matches.map((m) => [m.matchId, m.outcome]));
    expect(byId['m1']).toBe('win');
    expect(byId['m2']).toBe('loss');
    expect(byId['m3']).toBe('draw');
  });

  it('the net delta matches exactly what the ledger recorded for that specific match', () => {
    const { ledger, mh } = setup();
    // alice wins a 100-stake match. pot=200, rake=round(200*0.05)=10.
    // alice: −100 escrow + 190 win = +90. bob: −100 escrow = −100.
    playMatch(ledger, mh, 'm1', 'rps', ['alice', 'bob'], 'alice', 100);

    const aliceRow = mh.getRecentMatches('alice').matches[0];
    const bobRow = mh.getRecentMatches('bob').matches[0];
    expect(aliceRow.delta).toBe(90);
    expect(bobRow.delta).toBe(-100);
  });

  it('a second unrelated match does not pollute the first match\'s delta (per-match, not per-player-lifetime)', () => {
    const { ledger, mh } = setup();
    playMatch(ledger, mh, 'm1', 'rps', ['alice', 'bob'], 'alice', 100); // alice +90
    playMatch(ledger, mh, 'm2', 'rps', ['alice', 'carol'], 'carol', 50); // alice −50

    const res = mh.getRecentMatches('alice');
    const byId = Object.fromEntries(res.matches.map((m) => [m.matchId, m.delta]));
    expect(byId['m1']).toBe(90);
    expect(byId['m2']).toBe(-50);
  });

  it('excludes void (refunded) matches entirely — documented choice, issue #400', () => {
    const { ledger, mh } = setup();
    ledger.escrow('alice', 'v1', 100);
    ledger.escrow('bob', 'v1', 100);
    ledger.settle('v1', 'void', undefined, 200, 0.05);
    mh.recordResult('v1', 'rps', ['alice', 'bob'], 'void', undefined, 100);
    playMatch(ledger, mh, 'm1', 'rps', ['alice', 'bob'], 'alice', 100); // a real result too

    const res = mh.getRecentMatches('alice');
    expect(res.matches.map((m) => m.matchId)).toEqual(['m1']);
    expect(res.matches.map((m) => m.matchId)).not.toContain('v1');
    expect(res.total).toBe(1); // the void match doesn't count toward total either
  });

  it('orders newest-settled-first', async () => {
    const { ledger, mh } = setup();
    playMatch(ledger, mh, 'm1', 'rps', ['alice', 'bob'], 'alice', 100);
    await new Promise((r) => setTimeout(r, 5));
    playMatch(ledger, mh, 'm2', 'rps', ['alice', 'bob'], 'bob', 100);

    const res = mh.getRecentMatches('alice');
    expect(res.matches.map((m) => m.matchId)).toEqual(['m2', 'm1']);
  });

  it('paginates correctly via limit/offset, and total reflects the full eligible count', () => {
    const { ledger, mh } = setup();
    for (let i = 0; i < 5; i++) {
      playMatch(ledger, mh, `m${i}`, 'rps', ['alice', 'bob'], 'alice', 10);
    }

    const page1 = mh.getRecentMatches('alice', 2, 0);
    expect(page1.matches).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.limit).toBe(2);
    expect(page1.offset).toBe(0);

    const page2 = mh.getRecentMatches('alice', 2, 2);
    expect(page2.matches).toHaveLength(2);

    const page3 = mh.getRecentMatches('alice', 2, 4);
    expect(page3.matches).toHaveLength(1);

    // No overlap across pages.
    const allIds = [...page1.matches, ...page2.matches, ...page3.matches].map((m) => m.matchId);
    expect(new Set(allIds).size).toBe(5);
  });

  it('defaults to limit 10 when omitted, and clamps an oversized limit to the cap (50)', () => {
    const { ledger, mh } = setup();
    for (let i = 0; i < 3; i++) {
      playMatch(ledger, mh, `m${i}`, 'rps', ['alice', 'bob'], 'alice', 10);
    }

    expect(mh.getRecentMatches('alice').limit).toBe(10);
    expect(mh.getRecentMatches('alice', 100_000).limit).toBe(50);
  });

  it('clamps a negative offset up to 0 rather than erroring', () => {
    const { ledger, mh } = setup();
    playMatch(ledger, mh, 'm1', 'rps', ['alice', 'bob'], 'alice', 10);

    const res = mh.getRecentMatches('alice', 10, -5);
    expect(res.offset).toBe(0);
    expect(res.matches).toHaveLength(1);
  });

  // ─── opponentTier (issue #440) ─────────────────────────────────────────
  // opponentTier is derived via tierForXp AT QUERY TIME from the opponent's current
  // xp_lifetime in the `rewards` table — never reimplemented here, never stored/snapshotted.

  it("reports the opponent's current VIP tier, derived from their xp_lifetime", () => {
    const db = freshDb();
    const ledger = createLedger(db);
    const rewards = createRewards(db, ledger);
    const mh = createMatchHistory(db, new Map([['rps', RPS_WIN_RATE]]));
    ledger.grant('alice');
    ledger.grant('bob');

    // Give bob enough XP to clear the Bronze threshold (5,000) — see rewards.ts's VIP_ROWS.
    rewards.getSnapshot('bob'); // ensure the row exists before writing xp_lifetime directly
    db.prepare(`UPDATE rewards SET xp_lifetime = ? WHERE account_id = ?`).run(6_000, 'bob');

    playMatch(ledger, mh, 'm1', 'rps', ['alice', 'bob'], 'alice', 100);

    const [row] = mh.getRecentMatches('alice').matches;
    expect(row.opponentId).toBe('bob');
    expect(row.opponentTier).toBe('Bronze');
  });

  it("reports 'Unranked' when the opponent has no rewards row at all", () => {
    const { ledger, mh } = setup(); // setup() never wires up rewards — bob has no xp_lifetime
    playMatch(ledger, mh, 'm1', 'rps', ['alice', 'bob'], 'alice', 100);

    const [row] = mh.getRecentMatches('alice').matches;
    expect(row.opponentTier).toBe('Unranked');
  });

  it("reports 'Unranked' when the opponent has a rewards row but hasn't cleared Wood (500 XP)", () => {
    const db = freshDb();
    const ledger = createLedger(db);
    const rewards = createRewards(db, ledger);
    const mh = createMatchHistory(db, new Map([['rps', RPS_WIN_RATE]]));
    ledger.grant('alice');
    ledger.grant('bob');
    rewards.getSnapshot('bob'); // creates bob's row at xp_lifetime = 0

    playMatch(ledger, mh, 'm1', 'rps', ['alice', 'bob'], 'alice', 100);

    const [row] = mh.getRecentMatches('alice').matches;
    expect(row.opponentTier).toBe('Unranked');
  });
});

describe('getPopularity (issue #465)', () => {
  it('returns an empty map when no matches have been recorded', () => {
    const mh = createMatchHistory(freshDb());
    expect(mh.getPopularity()).toEqual({});
  });

  it('counts settled matches per gameId', () => {
    const mh = createMatchHistory(freshDb());
    mh.recordResult('m1', 'rps', ['alice', 'bob'], 'win', 'alice', 100);
    mh.recordResult('m2', 'rps', ['alice', 'carol'], 'win', 'carol', 100);
    mh.recordResult('m3', 'chess', ['bob', 'carol'], 'draw', undefined, 50);

    expect(mh.getPopularity()).toEqual({ rps: 2, chess: 1 });
  });

  it('excludes void matches (never really played, same convention as getRecentMatches)', () => {
    const mh = createMatchHistory(freshDb());
    mh.recordResult('m1', 'rps', ['alice', 'bob'], 'win', 'alice', 100);
    mh.recordResult('m2', 'rps', ['alice', 'bob'], 'void', undefined, 100);

    expect(mh.getPopularity()).toEqual({ rps: 1 });
  });

  it('a gameId with zero settled matches is absent, not present with 0', () => {
    const mh = createMatchHistory(freshDb());
    mh.recordResult('m1', 'rps', ['alice', 'bob'], 'win', 'alice', 100);
    const popularity = mh.getPopularity();
    expect('chess' in popularity).toBe(false);
  });
});
