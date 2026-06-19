import { describe, beforeEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import type { GameModule, GameState, PlayerId, Outcome, ApplyResult, Rng } from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';
import { createLedger, createMatchmaking, GRANT_AMOUNT, PLATFORM_ACCOUNT } from './index.js';

// ─── Minimal mock game module (no legal moves, never terminal) ────────────────

const mockModule: GameModule = {
  meta: {
    id: 'mock',
    displayName: 'Mock Game',
    minPlayers: 2,
    maxPlayers: 2,
    ranking: { kind: 'win_rate' },
    bet: { minStake: 10, maxStake: 500, symmetricStake: true },
    averageDurationSec: 5,
    rakeRate: 0.025,
  },
  init: (players: PlayerId[]) => ({ players }),
  legalMoves: () => [],
  applyMove: (state: GameState) => ({ state, events: [] }),
  isTerminal: () => false,
  outcome: () => ({ type: 'draw' }),
  viewFor: (state: GameState) => state,
  forfeit: (state: GameState) => state,
};

// ─── RPS-like module for S5/S6/S8 tests ──────────────────────────────────────
// Simultaneous single-move game with hidden info, draw support, forfeit.

type RpsChoice = 'rock' | 'paper' | 'scissors';
const RPS_CHOICES = ['rock', 'paper', 'scissors'] as const;

interface RpsState {
  players: [PlayerId, PlayerId];
  choices: Partial<Record<PlayerId, RpsChoice>>;
  forcedOutcome?: Outcome;
}

function beatsRps(a: RpsChoice, b: RpsChoice): -1 | 0 | 1 {
  if (a === b) return 0;
  if ((a === 'rock' && b === 'scissors') || (a === 'scissors' && b === 'paper') || (a === 'paper' && b === 'rock')) return 1;
  return -1;
}

function castRps(state: GameState): RpsState {
  return state as RpsState;
}

const rpsLikeModule: GameModule = {
  meta: {
    id: 'rpslike',
    displayName: 'RPS-like Test Game',
    minPlayers: 2,
    maxPlayers: 2,
    ranking: { kind: 'win_rate' },
    bet: { minStake: 10, maxStake: 500, symmetricStake: true },
    averageDurationSec: 5,
    // S6 settlement tests assert a 10% rake — keep this in sync with their expected math.
    rakeRate: 0.1,
  },
  init: (players: PlayerId[]) => ({
    players: [players[0], players[1]],
    choices: {},
  } as RpsState),
  legalMoves: (state: GameState, playerId: PlayerId) => {
    const s = castRps(state);
    if (s.forcedOutcome !== undefined || playerId in s.choices) return [];
    return [...RPS_CHOICES];
  },
  applyMove: (state: GameState, move: unknown, ctx): ApplyResult => {
    const s = castRps(state);
    const { playerId } = ctx;
    if (s.forcedOutcome !== undefined || playerId in s.choices) {
      throw new IllegalMove(`${playerId} already moved`);
    }
    if (!RPS_CHOICES.includes(move as RpsChoice)) {
      throw new IllegalMove(`Invalid move: ${String(move)}`);
    }
    const newState: RpsState = { ...s, choices: { ...s.choices, [playerId]: move as RpsChoice } };
    // Event payload deliberately omits the choice — only announces that a move was made.
    return { state: newState, events: [{ type: 'move_made', payload: { playerId } }] };
  },
  isTerminal: (state: GameState) => {
    const s = castRps(state);
    return s.forcedOutcome !== undefined || s.players.every((p) => p in s.choices);
  },
  outcome: (state: GameState): Outcome => {
    const s = castRps(state);
    if (s.forcedOutcome !== undefined) return s.forcedOutcome;
    const [p1, p2] = s.players;
    const c1 = s.choices[p1]!;
    const c2 = s.choices[p2]!;
    const r = beatsRps(c1, c2);
    if (r === 0) return { type: 'draw' };
    return { type: 'win', winner: r === 1 ? p1 : p2 };
  },
  viewFor: (state: GameState, playerId: PlayerId): GameState => {
    const s = castRps(state);
    const terminal = s.forcedOutcome !== undefined || s.players.every((p) => p in s.choices);
    if (terminal) return s;
    // Redact opponent's choice entirely (structural absence).
    const redacted: Partial<Record<PlayerId, RpsChoice>> = {};
    const own = s.choices[playerId];
    if (own !== undefined) redacted[playerId] = own;
    return { ...s, choices: redacted };
  },
  forfeit: (state: GameState, quitter: PlayerId): GameState => {
    const s = castRps(state);
    const opponent = s.players.find((p) => p !== quitter);
    const opponentMoved = opponent !== undefined && opponent in s.choices;
    const forcedOutcome: Outcome = opponentMoved ? { type: 'win', winner: opponent as PlayerId } : { type: 'void' };
    return { ...s, forcedOutcome };
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setup(modules: GameModule[] = [mockModule]) {
  const db = new Database(':memory:');
  const ledger = createLedger(db);
  const matchmaking = createMatchmaking(ledger, modules);
  return { db, ledger, matchmaking };
}

function grantAndJoin(
  ledger: ReturnType<typeof createLedger>,
  matchmaking: ReturnType<typeof createMatchmaking>,
  playerId: string,
  stake = 100,
  gameId = 'mock',
) {
  ledger.grant(playerId);
  return matchmaking.joinQueue(playerId, gameId, stake);
}

/** Set up a matched RPS-like game. */
function setupRpsMatch(stake = 50) {
  const { db, ledger, matchmaking } = setup([rpsLikeModule]);
  ledger.grant('alice');
  ledger.grant('bob');
  matchmaking.joinQueue('alice', 'rpslike', stake);
  const r2 = matchmaking.joinQueue('bob', 'rpslike', stake);
  if (r2.status !== 'matched') throw new Error('expected matched');
  return { db, ledger, matchmaking, matchId: r2.matchId };
}

// ─── Existing queue / join tests ──────────────────────────────────────────────

describe('matchmaking', () => {
  let ledger: ReturnType<typeof createLedger>;
  let matchmaking: ReturnType<typeof createMatchmaking>;

  beforeEach(() => {
    ({ ledger, matchmaking } = setup());
  });

  it('first player to join receives "waiting" status', () => {
    ledger.grant('alice');
    const result = matchmaking.joinQueue('alice', 'mock', 100);
    expect(result.status).toBe('waiting');
    expect(result.matchId).toBeTruthy();
  });

  it('two players joining the same (gameId, stake) queue are paired', () => {
    const r1 = grantAndJoin(ledger, matchmaking, 'alice', 100);
    const r2 = grantAndJoin(ledger, matchmaking, 'bob', 100);

    expect(r1.status).toBe('waiting');
    expect(r2.status).toBe('matched');
    if (r2.status === 'matched') {
      expect(r2.opponentId).toBe('alice');
      expect(r2.matchId).toBe(r1.matchId);
      expect(r2.initialState).toBeTruthy();
    }
  });

  it('joining with a stake below minStake throws', () => {
    ledger.grant('alice');
    expect(() => matchmaking.joinQueue('alice', 'mock', 5)).toThrow(/range/i);
  });

  it('joining with a stake above maxStake throws', () => {
    ledger.grant('alice');
    expect(() => matchmaking.joinQueue('alice', 'mock', 600)).toThrow(/range/i);
  });

  it('joining with insufficient balance throws', () => {
    expect(() => matchmaking.joinQueue('alice', 'mock', 100)).toThrow(/balance/i);
  });

  it('joining with a stake exactly equal to balance throws (after escrow is insufficient)', () => {
    ledger.grant('alice');
    const overStake = GRANT_AMOUNT + 1;
    expect(() => matchmaking.joinQueue('alice', 'mock', overStake)).toThrow();
  });

  it('leaveQueue before matching refunds the escrow; balance returns to pre-join level', () => {
    ledger.grant('alice');
    const before = ledger.getBalance('alice');

    const result = matchmaking.joinQueue('alice', 'mock', 100);
    expect(result.status).toBe('waiting');
    expect(ledger.getBalance('alice')).toBe(before - 100);

    matchmaking.leaveQueue('alice', 'mock', 100);
    expect(ledger.getBalance('alice')).toBe(before);
  });

  it('escrow and settle share the same matchId (draw restores both balances)', () => {
    ledger.grant('alice');
    ledger.grant('bob');

    const r1 = matchmaking.joinQueue('alice', 'mock', 100);
    const r2 = matchmaking.joinQueue('bob', 'mock', 100);
    expect(r2.status).toBe('matched');

    const matchId = r1.matchId;
    ledger.settle(matchId, 'draw', undefined, 200, 0.1);

    expect(ledger.getBalance('alice')).toBe(GRANT_AMOUNT);
    expect(ledger.getBalance('bob')).toBe(GRANT_AMOUNT);
  });

  it('after a match forms, getActiveMatch returns the match record', () => {
    grantAndJoin(ledger, matchmaking, 'alice', 100);
    const r2 = grantAndJoin(ledger, matchmaking, 'bob', 100);

    if (r2.status !== 'matched') throw new Error('expected matched');
    const match = matchmaking.getActiveMatch(r2.matchId);
    expect(match).toBeDefined();
    expect(match!.gameId).toBe('mock');
    expect(match!.players).toContain('alice');
    expect(match!.players).toContain('bob');
  });

  it('getActiveMatch returns undefined for unknown matchId', () => {
    expect(matchmaking.getActiveMatch('no-such-id')).toBeUndefined();
  });

  it('listGames returns the registered module meta', () => {
    const games = matchmaking.listGames();
    expect(games).toHaveLength(1);
    expect(games[0].id).toBe('mock');
  });
});

// ─── S5: applyMove ────────────────────────────────────────────────────────────

describe('S5 — applyMove', () => {
  it('valid move updates state; events contain playerId but not the choice', () => {
    const { matchmaking, matchId } = setupRpsMatch();

    const result = matchmaking.applyMove(matchId, 'alice', 'rock', Date.now());

    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe('move_made');
    expect(result.events[0].payload).toEqual({ playerId: 'alice' });
    // 'rock' must not appear anywhere in the event payload
    expect(JSON.stringify(result.events)).not.toContain('rock');
  });

  it('applyMove with an illegal move (duplicate) throws IllegalMove; state is unchanged', () => {
    const { matchmaking, matchId } = setupRpsMatch();

    matchmaking.applyMove(matchId, 'alice', 'rock', Date.now());

    expect(() => matchmaking.applyMove(matchId, 'alice', 'scissors', Date.now())).toThrow(IllegalMove);

    // State must be unchanged — alice still has one legal move list that is empty (already moved)
    const match = matchmaking.getActiveMatch(matchId)!;
    const legalAfter = rpsLikeModule.legalMoves(match.state, 'alice');
    expect(legalAfter).toHaveLength(0); // still the same: alice already moved
  });

  it("after P1 moves, viewFor for P2 does not contain P1's choice (structural absence)", () => {
    const { matchmaking, matchId } = setupRpsMatch();

    matchmaking.applyMove(matchId, 'alice', 'rock', Date.now());

    const match = matchmaking.getActiveMatch(matchId)!;
    const viewForBob = rpsLikeModule.viewFor(match.state, 'bob') as RpsState;

    // 'alice' key must be entirely absent from viewForBob.choices
    expect('alice' in viewForBob.choices).toBe(false);
    expect(JSON.stringify(viewForBob)).not.toContain('rock');
  });
});

// ─── S6: settleMatch ─────────────────────────────────────────────────────────

describe('S6 — settleMatch (win)', () => {
  it('winner receives pot minus rake; PLATFORM receives rake; ledger sums to zero', () => {
    const stake = 100;
    const { ledger, matchmaking, matchId } = setupRpsMatch(stake);
    // settleMatch reads the rake rate from the module meta (rpsLikeModule declares 0.1).
    const feeRate = rpsLikeModule.meta.rakeRate;
    const pot = stake * 2; // 200
    const rake = Math.round(pot * feeRate); // 20

    // alice plays rock, bob plays scissors → alice wins
    matchmaking.applyMove(matchId, 'alice', 'rock', Date.now());
    matchmaking.applyMove(matchId, 'bob', 'scissors', Date.now());

    const settled = matchmaking.settleMatch(matchId);

    expect(settled.outcome).toEqual({ type: 'win', winner: 'alice' });

    // alice: started with GRANT_AMOUNT, escrowed 100, won pot-rake
    expect(settled.settlement['alice'].delta).toBe(stake - rake); // +80 (100 − 20)
    expect(settled.settlement['bob'].delta).toBe(-stake); // -100

    expect(ledger.getBalance('alice')).toBe(GRANT_AMOUNT + stake - rake);
    expect(ledger.getBalance('bob')).toBe(GRANT_AMOUNT - stake);
    expect(ledger.getBalance(PLATFORM_ACCOUNT)).toBe(rake);

    // Conservation: total money is preserved
    const total = ledger.getBalance('alice') + ledger.getBalance('bob') + ledger.getBalance(PLATFORM_ACCOUNT);
    expect(total).toBe(2 * GRANT_AMOUNT);
  });
});

describe('S6 — settleMatch (draw)', () => {
  it('draw refunds both stakes; no RAKE entry; ledger sums to zero', () => {
    const stake = 100;
    const { ledger, matchmaking, matchId } = setupRpsMatch(stake);

    // both choose rock → draw
    matchmaking.applyMove(matchId, 'alice', 'rock', Date.now());
    matchmaking.applyMove(matchId, 'bob', 'rock', Date.now());

    const settled = matchmaking.settleMatch(matchId);

    expect(settled.outcome).toEqual({ type: 'draw' });
    expect(settled.settlement['alice'].delta).toBe(0);
    expect(settled.settlement['bob'].delta).toBe(0);

    expect(ledger.getBalance('alice')).toBe(GRANT_AMOUNT);
    expect(ledger.getBalance('bob')).toBe(GRANT_AMOUNT);
    expect(ledger.getBalance(PLATFORM_ACCOUNT)).toBe(0);

    // Confirm no RAKE entry was written
    const platformEntries = ledger.getEntries(PLATFORM_ACCOUNT);
    expect(platformEntries.filter((e) => e.type === 'RAKE')).toHaveLength(0);
  });
});

describe('S6 — settleMatch idempotency', () => {
  it('second call to settleMatch returns the same result; ledger entry count unchanged', () => {
    const { ledger, matchmaking, matchId } = setupRpsMatch(50);

    matchmaking.applyMove(matchId, 'alice', 'rock', Date.now());
    matchmaking.applyMove(matchId, 'bob', 'scissors', Date.now());

    const first = matchmaking.settleMatch(matchId);
    const aliceEntriesBefore = ledger.getEntries('alice').length;

    const second = matchmaking.settleMatch(matchId);
    const aliceEntriesAfter = ledger.getEntries('alice').length;

    expect(second.outcome).toEqual(first.outcome);
    expect(second.settlement['alice'].delta).toBe(first.settlement['alice'].delta);
    expect(second.settlement['bob'].delta).toBe(first.settlement['bob'].delta);
    expect(aliceEntriesAfter).toBe(aliceEntriesBefore); // no new entries written
  });
});

// ─── S8: getCompletedMatch / match.resume idempotency ────────────────────────

describe('S8 — getCompletedMatch', () => {
  it('returns the outcome and settlement after settlement; undefined before', () => {
    const { matchmaking, matchId } = setupRpsMatch(50);

    expect(matchmaking.getCompletedMatch(matchId)).toBeUndefined();

    matchmaking.applyMove(matchId, 'alice', 'rock', Date.now());
    matchmaking.applyMove(matchId, 'bob', 'scissors', Date.now());
    matchmaking.settleMatch(matchId);

    const completed = matchmaking.getCompletedMatch(matchId);
    expect(completed).toBeDefined();
    expect(completed!.outcome).toEqual({ type: 'win', winner: 'alice' });
  });

  it('match.resume on a completed match returns stored result without a second ledger write', () => {
    const { ledger, matchmaking, matchId } = setupRpsMatch(50);

    matchmaking.applyMove(matchId, 'alice', 'rock', Date.now());
    matchmaking.applyMove(matchId, 'bob', 'scissors', Date.now());
    matchmaking.settleMatch(matchId);

    const entriesBefore = ledger.getEntries('alice').length;

    // Simulate match.resume by calling getCompletedMatch (no ledger write).
    const completed = matchmaking.getCompletedMatch(matchId);
    expect(completed).toBeDefined();
    expect(completed!.settlement['alice']).toBeDefined();

    // No new ledger entries were written.
    expect(ledger.getEntries('alice').length).toBe(entriesBefore);
  });
});

// ─── Forfeit ─────────────────────────────────────────────────────────────────

describe('forfeitMatch', () => {
  it('forfeit when opponent has already moved → opponent wins; pot settled correctly', () => {
    const stake = 100;
    const { ledger, matchmaking, matchId } = setupRpsMatch(stake);
    // The rake comes from the module meta (rpsLikeModule declares 0.1), not a passed rate.
    const feeRate = rpsLikeModule.meta.rakeRate;
    const pot = stake * 2;
    const rake = Math.round(pot * feeRate);

    // bob moves first, then alice forfeits
    matchmaking.applyMove(matchId, 'bob', 'rock', Date.now());
    const settled = matchmaking.forfeitMatch(matchId, 'alice');

    expect(settled.outcome).toEqual({ type: 'win', winner: 'bob' });
    expect(ledger.getBalance('bob')).toBe(GRANT_AMOUNT + stake - rake);
    expect(ledger.getBalance('alice')).toBe(GRANT_AMOUNT - stake);
  });

  it('forfeit when neither player has moved → void; both stakes refunded', () => {
    const { ledger, matchmaking, matchId } = setupRpsMatch(100);

    const settled = matchmaking.forfeitMatch(matchId, 'alice');

    expect(settled.outcome).toEqual({ type: 'void' });
    expect(ledger.getBalance('alice')).toBe(GRANT_AMOUNT);
    expect(ledger.getBalance('bob')).toBe(GRANT_AMOUNT);
  });

  it('forfeit is idempotent — calling twice returns the same result', () => {
    const { matchmaking, matchId } = setupRpsMatch(50);
    matchmaking.applyMove(matchId, 'bob', 'rock', Date.now());

    const first = matchmaking.forfeitMatch(matchId, 'alice');
    const second = matchmaking.forfeitMatch(matchId, 'alice');

    expect(second.outcome).toEqual(first.outcome);
    expect(second.settlement['bob'].delta).toBe(first.settlement['bob'].delta);
  });
});

// ─── Stale-match move-timeout sweep (#31) ─────────────────────────────────────
// Server-authoritative: resolves matches stuck past their move deadline regardless
// of socket state, so escrow is never orphaned. Uses an injectable clock.

describe('sweepStaleMatches', () => {
  const TIMEOUT = 120_000;

  function setupWithClock(stake = 100) {
    let clock = 1_000_000;
    const db = new Database(':memory:');
    const ledger = createLedger(db);
    const matchmaking = createMatchmaking(ledger, [rpsLikeModule], undefined, {
      now: () => clock,
      turnTimeoutMs: TIMEOUT,
    });
    ledger.grant('alice');
    ledger.grant('bob');
    matchmaking.joinQueue('alice', 'rpslike', stake);
    const r = matchmaking.joinQueue('bob', 'rpslike', stake);
    if (r.status !== 'matched') throw new Error('expected matched');
    return {
      ledger,
      matchmaking,
      matchId: r.matchId,
      advance: (ms: number) => {
        clock += ms;
      },
      now: () => clock,
    };
  }

  it('a stuck match with NO move past the deadline → void; both refunded (ledger net unchanged)', () => {
    const { ledger, matchmaking, matchId, advance, now } = setupWithClock(100);

    advance(TIMEOUT + 1);
    const resolved = matchmaking.sweepStaleMatches(now());

    expect(resolved).toHaveLength(1);
    expect(resolved[0].matchId).toBe(matchId);
    expect(resolved[0].outcome).toEqual({ type: 'void' });
    // Both stakes refunded in full, no rake — net ledger movement is zero.
    expect(ledger.getBalance('alice')).toBe(GRANT_AMOUNT);
    expect(ledger.getBalance('bob')).toBe(GRANT_AMOUNT);
    expect(ledger.getBalance(PLATFORM_ACCOUNT)).toBe(0);
    // The match is settled and removed from the active set — no orphaned escrow.
    expect(matchmaking.getActiveMatch(matchId)).toBeUndefined();
  });

  it('one player moved, the other times out → non-responder forfeits, mover settled, no orphaned escrow', () => {
    const stake = 100;
    const { ledger, matchmaking, matchId, advance, now } = setupWithClock(stake);
    // Rake is sourced from the module meta (rpsLikeModule = 0.1), applied generically by the core.
    const rake = Math.round(stake * 2 * rpsLikeModule.meta.rakeRate);

    // bob moves; alice never responds and blows the deadline.
    matchmaking.applyMove(matchId, 'bob', 'rock', now());
    advance(TIMEOUT + 1);
    const resolved = matchmaking.sweepStaleMatches(now());

    expect(resolved).toHaveLength(1);
    expect(resolved[0].outcome).toEqual({ type: 'win', winner: 'bob' });
    expect(ledger.getBalance('bob')).toBe(GRANT_AMOUNT + stake - rake);
    expect(ledger.getBalance('alice')).toBe(GRANT_AMOUNT - stake);
    // Conservation: nothing left escrowed — the two balances plus rake reconstruct both grants.
    const total =
      ledger.getBalance('alice') + ledger.getBalance('bob') + ledger.getBalance(PLATFORM_ACCOUNT);
    expect(total).toBe(GRANT_AMOUNT * 2);
    expect(matchmaking.getActiveMatch(matchId)).toBeUndefined();
  });

  it('refreshes the deadline on a move — an active, progressing match is NOT swept', () => {
    const { matchmaking, matchId, advance, now } = setupWithClock(100);

    // Just before the deadline, bob moves → the deadline pushes out by another TIMEOUT.
    advance(TIMEOUT - 1);
    matchmaking.applyMove(matchId, 'bob', 'rock', now());

    // Past the ORIGINAL deadline, but inside the refreshed window: must NOT sweep.
    advance(2);
    expect(matchmaking.sweepStaleMatches(now())).toEqual([]);
    expect(matchmaking.getActiveMatch(matchId)).toBeDefined();

    // Once the refreshed deadline elapses, it sweeps (bob moved → alice forfeits).
    advance(TIMEOUT);
    const resolved = matchmaking.sweepStaleMatches(now());
    expect(resolved).toHaveLength(1);
    expect(resolved[0].outcome).toEqual({ type: 'win', winner: 'bob' });
  });

  it('does not sweep a match that is still within its deadline', () => {
    const { matchmaking, advance, now } = setupWithClock(100);
    advance(TIMEOUT - 1);
    expect(matchmaking.sweepStaleMatches(now())).toEqual([]);
  });
});

// ─── Per-player move timers (opt-in capability) ──────────────────────────────
// Two tiny fake modules exercise both auto-action shapes without registering a real game.

describe('per-player move timers', () => {
  // Captures the rng the core passes to timeoutMove, to assert it's the seeded match rng.
  let capturedRng: Rng | null = null;

  interface StandState {
    players: [PlayerId, PlayerId];
    hits: Record<PlayerId, number>;
    stood: Record<PlayerId, boolean>;
    forcedOutcome?: Outcome;
  }

  // Concurrent "stand on timeout" game (Blackjack-shape): both players act independently;
  // each can hit (stay) or stand (done); on timeout the core injects 'stand'.
  const standModule: GameModule = {
    meta: {
      id: 'standgame', displayName: 'Stand Game', minPlayers: 2, maxPlayers: 2,
      ranking: { kind: 'win_rate' }, bet: { minStake: 10, maxStake: 500, symmetricStake: true },
      averageDurationSec: 5, rakeRate: 0.025, moveTimeoutMs: 1000,
    },
    init: (players) => ({
      players: [players[0], players[1]],
      hits: { [players[0]]: 0, [players[1]]: 0 },
      stood: { [players[0]]: false, [players[1]]: false },
    } as StandState),
    legalMoves: (state, p) => ((state as StandState).stood[p] ? [] : ['hit', 'stand']),
    applyMove: (state, move, ctx): ApplyResult => {
      const s = state as StandState;
      const ns: StandState = { ...s, hits: { ...s.hits }, stood: { ...s.stood } };
      if ((move as string) === 'hit') ns.hits[ctx.playerId]++;
      else ns.stood[ctx.playerId] = true;
      return { state: ns, events: [{ type: 'acted', payload: { playerId: ctx.playerId, move } }] };
    },
    isTerminal: (state) => {
      const s = state as StandState;
      return s.forcedOutcome !== undefined || s.players.every((p) => s.stood[p]);
    },
    outcome: (state): Outcome => {
      const s = state as StandState;
      if (s.forcedOutcome) return s.forcedOutcome;
      const [a, b] = s.players;
      if (s.hits[a] === s.hits[b]) return { type: 'draw' };
      return { type: 'win', winner: s.hits[a] > s.hits[b] ? a : b };
    },
    viewFor: (state) => state,
    forfeit: (state, quitter) => {
      const s = state as StandState;
      const opp = s.players.find((p) => p !== quitter)!;
      return { ...s, forcedOutcome: { type: 'win', winner: opp } } as GameState;
    },
    timeoutMove: () => 'stand',
  };

  interface MinesState {
    players: [PlayerId, PlayerId];
    covered: Record<PlayerId, number[]>;
  }

  // "Reveal a random covered square on timeout" game (Mines-shape).
  const minesModule: GameModule = {
    meta: {
      id: 'minesgame', displayName: 'Mines Game', minPlayers: 2, maxPlayers: 2,
      ranking: { kind: 'net_winnings' }, bet: { minStake: 10, maxStake: 500, symmetricStake: true },
      averageDurationSec: 5, rakeRate: 0.025, moveTimeoutMs: 1000,
    },
    init: (players) => ({
      players: [players[0], players[1]],
      covered: { [players[0]]: [0, 1, 2], [players[1]]: [0, 1, 2] },
    } as MinesState),
    legalMoves: (state, p) => (state as MinesState).covered[p].map(String),
    applyMove: (state, move, ctx): ApplyResult => {
      const s = state as MinesState;
      const idx = Number(move as string);
      return {
        state: { ...s, covered: { ...s.covered, [ctx.playerId]: s.covered[ctx.playerId].filter((x) => x !== idx) } },
        events: [],
      };
    },
    isTerminal: (state) => (state as MinesState).players.some((p) => (state as MinesState).covered[p].length === 0),
    outcome: (state): Outcome => {
      const s = state as MinesState;
      const [a] = s.players;
      return { type: 'win', winner: s.covered[a].length === 0 ? a : s.players[1] };
    },
    viewFor: (state) => state,
    forfeit: (state, quitter) => {
      const s = state as MinesState;
      const opp = s.players.find((p) => p !== quitter)!;
      return { ...s, covered: { ...s.covered, [opp]: [] } } as GameState;
    },
    timeoutMove: (state, p, rng) => {
      capturedRng = rng;
      const covered = (state as MinesState).covered[p];
      return String(covered[rng.int(0, covered.length - 1)]);
    },
  };

  function setupTimer(mod: GameModule, stake = 50) {
    let clock = 1_000_000;
    const db = new Database(':memory:');
    const ledger = createLedger(db);
    const mm = createMatchmaking(ledger, [mod], undefined, { now: () => clock });
    ledger.grant('alice');
    ledger.grant('bob');
    mm.joinQueue('alice', mod.meta.id, stake);
    const r = mm.joinQueue('bob', mod.meta.id, stake);
    if (r.status !== 'matched') throw new Error('expected matched');
    return { ledger, mm, matchId: r.matchId, advance: (ms: number) => { clock += ms; }, now: () => clock };
  }

  beforeEach(() => { capturedRng = null; });

  it('fires each expired player timer → injects the declared move (stand); terminal auto-move settles', () => {
    const { mm, matchId, advance, now } = setupTimer(standModule, 50);
    advance(1001); // both players had legal moves from the start → both timers expire
    const res = mm.sweepTimedOutMoves(now());

    // alice auto-stands first (non-terminal — bob still has moves), then bob (terminal).
    expect(res.map((r) => r.playerId)).toEqual(['alice', 'bob']);
    expect(res[0].terminal).toBe(false);
    expect(res[1].terminal).toBe(true);
    expect(res[1].outcome).toEqual({ type: 'draw' }); // 0 hits each
    expect(mm.getActiveMatch(matchId)).toBeUndefined(); // settled + removed
  });

  it('a real move resets that player timer; only the still-expired player is auto-moved', () => {
    const { mm, matchId, advance, now } = setupTimer(standModule, 50);
    advance(800);
    mm.applyMove(matchId, 'alice', 'hit', now()); // alice deadline → now+1000
    advance(400); // past bob's original deadline, before alice's reset one
    const res = mm.sweepTimedOutMoves(now());

    expect(res.map((r) => r.playerId)).toEqual(['bob']);
    const s = mm.getActiveMatch(matchId)!.state as StandState;
    expect(s.stood['bob']).toBe(true);
    expect(s.stood['alice']).toBe(false); // alice's timer was reset by her real move
  });

  it('a decisive auto-stand settles with the winner + per-game rake', () => {
    const { mm, matchId, ledger, advance, now } = setupTimer(standModule, 100);
    advance(100);
    mm.applyMove(matchId, 'alice', 'hit', now()); // alice: 1 hit
    mm.applyMove(matchId, 'alice', 'stand', now()); // alice done; only bob has a timer now
    advance(2000);
    const res = mm.sweepTimedOutMoves(now());

    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ playerId: 'bob', terminal: true });
    expect(res[0].outcome).toEqual({ type: 'win', winner: 'alice' });
    expect(res[0].settlement!['alice'].delta).toBe(95); // 100 − round(200*0.025)=5
    expect(res[0].settlement!['bob'].delta).toBe(-100);
    expect(ledger.getBalance(PLATFORM_ACCOUNT)).toBe(5);
  });

  it('injects a random LEGAL covered square via the seeded match rng (Mines-shape)', () => {
    const { mm, matchId, advance, now } = setupTimer(minesModule, 50);
    const before = [...(mm.getActiveMatch(matchId)!.state as MinesState).covered['alice']];
    advance(1001);
    const res = mm.sweepTimedOutMoves(now());

    expect(res.map((r) => r.playerId)).toEqual(['alice', 'bob']); // both auto-reveal one square
    const m = mm.getActiveMatch(matchId)!; // 2 squares left each → not terminal
    const after = (m.state as MinesState).covered['alice'];
    expect(after).toHaveLength(2);
    const revealed = before.find((x) => !after.includes(x));
    expect(before).toContain(revealed); // the auto-move was a legal (previously covered) square
    expect(capturedRng).toBe(m.rng); // deterministic seeded source, not ambient randomness
  });

  it('sweepStaleMatches does NOT forfeit an opt-in game (left to the timer sweep)', () => {
    const { mm, matchId, advance, now } = setupTimer(standModule, 50);
    advance(200_000); // far past any deadline
    expect(mm.sweepStaleMatches(now())).toEqual([]); // skipped, not forfeited
    expect(mm.getActiveMatch(matchId)).toBeDefined(); // still active
  });

  it('non-opt-in games are untouched by sweepTimedOutMoves (turn-based forfeit unchanged)', () => {
    const { matchmaking, matchId } = setupRpsMatch(50); // rpsLikeModule has no moveTimeoutMs
    expect(matchmaking.sweepTimedOutMoves(Date.now())).toEqual([]);
    expect(matchmaking.getActiveMatch(matchId)).toBeDefined();
  });
});
