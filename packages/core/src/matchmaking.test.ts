import { describe, beforeEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import type { GameModule, GameState, PlayerId, Outcome, ApplyResult, Rng, PlayerClocks } from '@rapidclash/shared';
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

  it('never matches an account against itself — a second session of the same player rests (#1)', () => {
    ledger.grant('alice');
    const granted = ledger.getBalance('alice');
    const r1 = matchmaking.joinQueue('alice', 'mock', 100);
    const r2 = matchmaking.joinQueue('alice', 'mock', 100); // alice's 2nd open session, same key
    expect(r1.status).toBe('waiting');
    expect(r2.status).toBe('waiting'); // self can never be its own opponent (invariant #1)
    // The 2nd session REUSES the resting entry (same matchId) — no duplicate queue entry, and the
    // stake is escrowed exactly ONCE (no double-debit, no orphaned bookkeeping).
    if (r1.status === 'waiting' && r2.status === 'waiting') expect(r2.matchId).toBe(r1.matchId);
    expect(ledger.getBalance('alice')).toBe(granted - 100);
  });

  it('a different player then matches the self-rested challenge normally', () => {
    ledger.grant('alice');
    const r1 = matchmaking.joinQueue('alice', 'mock', 100);
    matchmaking.joinQueue('alice', 'mock', 100); // 2nd session — still just waiting (reused)
    ledger.grant('bob');
    const rb = matchmaking.joinQueue('bob', 'mock', 100);
    expect(rb.status).toBe('matched');
    if (rb.status === 'matched' && r1.status === 'waiting') {
      expect(rb.opponentId).toBe('alice');
      expect(rb.matchId).toBe(r1.matchId); // bob pairs with alice's original resting entry
    }
  });

  it('pairs with the OLDEST different player, skipping the joiner’s own resting entry', () => {
    // bob rests first; alice rests behind him (different player → she matches bob, so to get a
    // self-entry-then-different-join we seed alice first, then alice again, then bob).
    ledger.grant('alice');
    matchmaking.joinQueue('alice', 'mock', 100); // alice rests
    matchmaking.joinQueue('alice', 'mock', 100); // alice again → reused, still one entry
    ledger.grant('bob');
    const rb = matchmaking.joinQueue('bob', 'mock', 100);
    expect(rb.status).toBe('matched');
    if (rb.status === 'matched') expect(rb.opponentId).toBe('alice'); // the different player pairs fine
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

// ─── Absolute scheduled deadlines (Crash) — generic core mode (THIRD timer shape) ───────────
// A tiny fake that declares `launch` + `scheduledDeadlines` + `timeoutMove` but NO moveTimeoutMs
// /timeControl — exercising the new generic scheduled-event path end-to-end, with no dependency on
// the real crash module. The core stamps `startedAt` via `launch`, schedules each player's
// absolute deadline, and injects `timeoutMove` on expiry through the same sweep.

describe('scheduled deadlines (absolute per-player auto-fire, Crash-shape)', () => {
  const CRASH_OFFSET = 5_000;
  interface RocketState {
    players: [PlayerId, PlayerId];
    startedAt: number;
    results: Record<PlayerId, number | undefined>; // banked "altitude" (= elapsed ms), 0 = crashed
  }
  const isResolved = (s: RocketState, p: PlayerId) => s.results[p] !== undefined;
  const isTerm = (s: RocketState) => s.players.every((p) => isResolved(s, p));

  const rocketModule: GameModule = {
    meta: {
      id: 'rocket', displayName: 'Rocket', minPlayers: 2, maxPlayers: 2,
      ranking: { kind: 'net_winnings' }, bet: { minStake: 1, maxStake: 100, symmetricStake: true },
      averageDurationSec: 5, rakeRate: 0.025,
    },
    init: (players) => ({ players: [players[0], players[1]], startedAt: 0, results: {} } as RocketState),
    launch: (state, now) => ({ ...(state as RocketState), startedAt: now } as GameState),
    legalMoves: (state, p) => {
      const s = state as RocketState;
      return !isTerm(s) && !isResolved(s, p) ? ['go'] : [];
    },
    applyMove: (state, _move, ctx): ApplyResult => {
      const s = state as RocketState;
      const elapsed = ctx.now - s.startedAt;
      const banked = elapsed >= CRASH_OFFSET ? 0 : elapsed; // crash busts to 0
      return { state: { ...s, results: { ...s.results, [ctx.playerId]: banked } } as GameState, events: [] };
    },
    isTerminal: (state) => isTerm(state as RocketState),
    outcome: (state): Outcome => {
      const s = state as RocketState;
      const [a, b] = s.players;
      const ba = s.results[a]!, bb = s.results[b]!;
      return ba === bb ? { type: 'draw' } : { type: 'win', winner: ba > bb ? a : b };
    },
    viewFor: (state) => state,
    forfeit: (state, quitter) => {
      const s = state as RocketState;
      const opp = s.players.find((p) => p !== quitter)!;
      return { ...s, results: { ...s.results, [quitter]: 0, [opp]: s.results[opp] ?? 1 } } as GameState;
    },
    scheduledDeadlines: (state) => {
      const s = state as RocketState;
      if (s.startedAt === 0 || isTerm(s)) return {};
      const out: Record<PlayerId, number> = {};
      for (const p of s.players) if (!isResolved(s, p)) out[p] = s.startedAt + CRASH_OFFSET;
      return out;
    },
    timeoutMove: () => 'go',
  };

  function setup(stake = 50) {
    let clock = 1_000_000;
    const db = new Database(':memory:');
    const ledger = createLedger(db);
    const mm = createMatchmaking(ledger, [rocketModule], undefined, { now: () => clock });
    ledger.grant('alice');
    ledger.grant('bob');
    mm.joinQueue('alice', 'rocket', stake);
    const r = mm.joinQueue('bob', 'rocket', stake);
    if (r.status !== 'matched') throw new Error('expected matched');
    return { ledger, mm, matchId: r.matchId, start: clock, advance: (ms: number) => { clock += ms; }, now: () => clock };
  }

  it('launch stamps startedAt and schedules both players at the absolute crash time', () => {
    const { mm, matchId, start } = setup();
    const match = mm.getActiveMatch(matchId)!;
    expect((match.state as RocketState).startedAt).toBe(start); // generic launch hook ran
    expect(match.playerDeadlines).toEqual({ alice: start + CRASH_OFFSET, bob: start + CRASH_OFFSET });
  });

  it('nobody ejects → the scheduled crash busts BOTH via the sweep → draw (refund)', () => {
    const { mm, matchId, advance, now, ledger } = setup(50);
    advance(CRASH_OFFSET + 100); // past the crash
    const res = mm.sweepTimedOutMoves(now());
    expect(res.map((r) => r.playerId)).toEqual(['alice', 'bob']); // both auto-ejected (crashed)
    expect(res[1].terminal).toBe(true);
    expect(res[1].outcome).toEqual({ type: 'draw' });
    expect(mm.getActiveMatch(matchId)).toBeUndefined(); // settled + removed
    expect(ledger.getBalance('alice')).toBe(GRANT_AMOUNT); // refunded, no rake
    expect(ledger.getBalance(PLATFORM_ACCOUNT)).toBe(0);
  });

  it('one banks before the crash, the other rides to the crash → banker wins (rake once)', () => {
    const { mm, matchId, advance, now, ledger } = setup(100);
    advance(2_000);
    mm.applyMove(matchId, 'alice', 'go', now()); // alice banks 2000
    // alice resolved → her deadline drops; bob still scheduled at the crash.
    expect(mm.getActiveMatch(matchId)!.playerDeadlines).toEqual({ bob: setupCrashAt(now(), 2_000) });
    advance(CRASH_OFFSET); // bob rides past the crash
    const res = mm.sweepTimedOutMoves(now());
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ playerId: 'bob', terminal: true });
    expect(res[0].outcome).toEqual({ type: 'win', winner: 'alice' });
    expect(res[0].settlement!['alice'].delta).toBe(95); // 100 − round(200·0.025)=5
    expect(ledger.getBalance(PLATFORM_ACCOUNT)).toBe(5);
  });

  // startedAt = (now at the bank) − 2000 elapsed; crash = startedAt + OFFSET.
  function setupCrashAt(nowAtBank: number, elapsedAtBank: number): number {
    return nowAtBank - elapsedAtBank + CRASH_OFFSET;
  }
});

// ─── Cumulative per-player clock (time control) — generic core mode ───────────
// A tiny turn-based fake that declares timeControl. The CORE seeds the clock at match start;
// the module ADVANCES it on each move (like chess). No dependency on the real chess module.

describe('time control (cumulative per-player clock)', () => {
  interface ClockState {
    players: [PlayerId, PlayerId];
    turn: PlayerId;
    moves: number;
    clock?: PlayerClocks;
    forcedOutcome?: Outcome;
  }
  const other = (s: ClockState, p: PlayerId) => (p === s.players[0] ? s.players[1] : s.players[0]);

  const clockModule: GameModule = {
    meta: {
      id: 'clockgame', displayName: 'Clock Game', minPlayers: 2, maxPlayers: 2,
      ranking: { kind: 'elo', k: 32 }, bet: { minStake: 10, maxStake: 500, symmetricStake: true },
      averageDurationSec: 60, rakeRate: 0.1,
      timeControl: { options: [{ id: 'fast', label: 'Fast', baseMs: 10_000, incrementMs: 0 }], defaultId: 'fast' },
    },
    init: (players) => ({ players: [players[0], players[1]], turn: players[0], moves: 0 } as ClockState),
    legalMoves: (state, p) => {
      const s = state as ClockState;
      return s.forcedOutcome === undefined && p === s.turn ? ['move'] : [];
    },
    applyMove: (state, _move, ctx): ApplyResult => {
      const s = state as ClockState;
      const newTurn = other(s, ctx.playerId);
      const ns: ClockState = { ...s, turn: newTurn, moves: s.moves + 1 };
      if (s.clock) {
        const used = ctx.now - s.clock.activeSince;
        ns.clock = {
          ...s.clock,
          remainingMs: { ...s.clock.remainingMs, [ctx.playerId]: Math.max(0, s.clock.remainingMs[ctx.playerId] - used) },
          active: newTurn,
          activeSince: ctx.now,
        };
      }
      return { state: ns, events: [] };
    },
    isTerminal: (state) => (state as ClockState).forcedOutcome !== undefined,
    outcome: (state) => (state as ClockState).forcedOutcome ?? { type: 'draw' },
    viewFor: (state) => state,
    forfeit: (state, quitter) => {
      const s = state as ClockState;
      const forced: Outcome = s.moves === 0 ? { type: 'void' } : { type: 'win', winner: other(s, quitter) };
      return { ...s, forcedOutcome: forced };
    },
  };

  function setupClock(stake = 100) {
    let clock = 1_000_000;
    const db = new Database(':memory:');
    const ledger = createLedger(db);
    const mm = createMatchmaking(ledger, [clockModule], undefined, { now: () => clock });
    ledger.grant('alice');
    ledger.grant('bob');
    mm.joinQueue('alice', 'clockgame', stake);
    const r = mm.joinQueue('bob', 'clockgame', stake);
    if (r.status !== 'matched') throw new Error('expected matched');
    return { ledger, mm, matchId: r.matchId, advance: (ms: number) => { clock += ms; }, now: () => clock };
  }
  const clockOf = (mm: ReturnType<typeof setupClock>['mm'], id: string) =>
    (mm.getActiveMatch(id)!.state as ClockState).clock!;

  it('seeds both budgets and makes the first mover active at match start', () => {
    const { mm, matchId, now } = setupClock();
    const c = clockOf(mm, matchId);
    expect(c.remainingMs['alice']).toBe(10_000);
    expect(c.remainingMs['bob']).toBe(10_000);
    expect(c.active).toBe('alice'); // first player to join = first to move
    expect(c.activeSince).toBe(now());
  });

  it("drains only the active player's budget on their turn, then switches the active clock", () => {
    const { mm, matchId, advance, now } = setupClock();
    advance(2000);
    mm.applyMove(matchId, 'alice', 'move', now());
    const c = clockOf(mm, matchId);
    expect(c.remainingMs['alice']).toBe(8_000); // drained by 2000
    expect(c.remainingMs['bob']).toBe(10_000); // untouched
    expect(c.active).toBe('bob'); // clock switched to the opponent
  });

  it('a player who never moves flags at 0 → loses on time (settles as a normal loss, rake once)', () => {
    const { ledger, mm, matchId, advance, now } = setupClock(100);
    advance(1000);
    mm.applyMove(matchId, 'alice', 'move', now()); // a move was played → not a pre-first-move void
    // bob is now active with a 10s budget; bob never moves.
    advance(10_001);
    const resolved = mm.sweepTimedOutMoves(now());

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ playerId: 'bob', terminal: true });
    expect(resolved[0].outcome).toEqual({ type: 'win', winner: 'alice' });
    // Settles like any decisive loss: rake = round(200 * 0.1) = 20 → +80 / −100.
    expect(resolved[0].settlement!['alice'].delta).toBe(80);
    expect(resolved[0].settlement!['bob'].delta).toBe(-100);
    expect(ledger.getBalance(PLATFORM_ACCOUNT)).toBe(20);
    expect(mm.getActiveMatch(matchId)).toBeUndefined(); // settled + removed
  });

  it('does not flag the active player before their budget is spent', () => {
    const { mm, matchId, advance, now } = setupClock();
    advance(9_999); // alice still has 1ms
    expect(mm.sweepTimedOutMoves(now())).toEqual([]);
    expect(mm.getActiveMatch(matchId)).toBeDefined();
  });

  it('the 120s per-move deadline is OFF for a clocked game (budget governs)', () => {
    const { mm, matchId, advance, now } = setupClock();
    advance(130_000); // far past MATCH_TURN_TIMEOUT_MS (120s)
    expect(mm.sweepStaleMatches(now())).toEqual([]); // clocked games are skipped here
    expect(mm.getActiveMatch(matchId)).toBeDefined(); // not forfeited by the per-match deadline
  });

  it('the per-move forfeit deadline still applies to an untimed game (unchanged)', () => {
    // rpsLikeModule declares neither timeControl nor moveTimeoutMs → still swept at the deadline.
    const { matchmaking, matchId } = setupRpsMatch(50);
    const TIMEOUT = 120_000;
    const resolved = matchmaking.sweepStaleMatches(Date.now() + TIMEOUT + 1);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].matchId).toBe(matchId);
  });

  it('determinism: the same moves + nows reproduce the identical flag and outcome', () => {
    function run() {
      const { mm, matchId, advance, now } = setupClock(100);
      advance(1500);
      mm.applyMove(matchId, 'alice', 'move', now());
      advance(10_001);
      return mm.sweepTimedOutMoves(now());
    }
    const a = run();
    const b = run();
    expect(a[0].playerId).toBe(b[0].playerId);
    expect(a[0].outcome).toEqual(b[0].outcome);
    // The recorded flag event carries its `now` so a replay reproduces it.
    expect((a[0].events[0] as { type: string }).type).toBe('flagged');
    expect((a[0].events[0] as { payload: { now: number } }).payload.now)
      .toBe((b[0].events[0] as { payload: { now: number } }).payload.now);
  });
});

// ─── Time control — matchmaking pairing (Part 2: 3-part FIFO key) ─────────────
describe('time control — pairing on (game, stake, control)', () => {
  // A self-contained clocked module declaring TWO controls (fast/slow, default fast), paired with
  // the untimed `rpsLikeModule` (module scope). The 3-part key keeps controls in separate pools.
  const tcModule: GameModule = {
    meta: {
      id: 'tcgame', displayName: 'TC Game', minPlayers: 2, maxPlayers: 2,
      ranking: { kind: 'elo', k: 32 }, bet: { minStake: 10, maxStake: 500, symmetricStake: true },
      averageDurationSec: 60, rakeRate: 0.1,
      timeControl: {
        options: [
          { id: 'fast', label: 'Fast', baseMs: 10_000, incrementMs: 0 },
          { id: 'slow', label: 'Slow', baseMs: 20_000, incrementMs: 0 },
        ],
        defaultId: 'fast',
      },
    },
    init: (players) => ({ players: [players[0], players[1]], turn: players[0] }),
    legalMoves: (state, p) => ((state as { turn: PlayerId }).turn === p ? ['move'] : []),
    applyMove: (state) => ({ state, events: [] }),
    isTerminal: () => false,
    outcome: () => ({ type: 'draw' }),
    viewFor: (state) => state,
    forfeit: (state) => state,
  };
  function mm() {
    const ledger = createLedger(new Database(':memory:'));
    const m = createMatchmaking(ledger, [tcModule, rpsLikeModule]);
    for (const p of ['alice', 'bob', 'carol', 'dave']) ledger.grant(p);
    return { ledger, m };
  }
  const clockOfMatch = (m: ReturnType<typeof mm>['m'], id: string) =>
    (m.getActiveMatch(id)!.state as { clock: PlayerClocks }).clock;

  it('pairs two players on the same stake AND control, seeding that control', () => {
    const { m } = mm();
    expect(m.joinQueue('alice', 'tcgame', 50, 'slow').status).toBe('waiting');
    const r = m.joinQueue('bob', 'tcgame', 50, 'slow');
    expect(r.status).toBe('matched');
    if (r.status === 'matched') {
      const c = clockOfMatch(m, r.matchId);
      expect(c.timeControlId).toBe('slow');
      expect(c.remainingMs['alice']).toBe(20_000); // slow base, not the default
    }
  });

  it('does NOT pair the same stake when the control differs (separate pools)', () => {
    const { m } = mm();
    expect(m.joinQueue('alice', 'tcgame', 50, 'fast').status).toBe('waiting');
    expect(m.joinQueue('bob', 'tcgame', 50, 'slow').status).toBe('waiting'); // different control → no match
    // A matching-control join pairs with the right waiter.
    const r = m.joinQueue('carol', 'tcgame', 50, 'fast');
    expect(r.status).toBe('matched');
    if (r.status === 'matched') expect(r.opponentId).toBe('alice');
  });

  it("defaults an omitted control to the game's default and returns the resolved id", () => {
    const { m } = mm();
    const w = m.joinQueue('alice', 'tcgame', 50); // no control given
    expect(w.status).toBe('waiting');
    if (w.status === 'waiting') expect(w.timeControlId).toBe('fast'); // defaultId
    const r = m.joinQueue('bob', 'tcgame', 50, 'fast'); // explicit default pairs with the omitted one
    expect(r.status).toBe('matched');
  });

  it('rejects an unknown control', () => {
    const { m } = mm();
    expect(() => m.joinQueue('alice', 'tcgame', 50, 'bogus')).toThrow(RangeError);
  });

  it("forces 'none' for an untimed game regardless of a passed control", () => {
    const { m } = mm();
    const w = m.joinQueue('alice', 'rpslike', 50, 'fast'); // control ignored for an untimed game
    expect(w.status).toBe('waiting');
    if (w.status === 'waiting') expect(w.timeControlId).toBe('none');
    // Another untimed join (no control) shares the 'none' pool → matched.
    expect(m.joinQueue('bob', 'rpslike', 50).status).toBe('matched');
  });

  it('the open-challenge feed carries the resting bet control', () => {
    const { m } = mm();
    const w = m.joinQueue('alice', 'tcgame', 50, 'slow');
    if (w.status !== 'waiting') throw new Error('expected waiting');
    // List from another viewer, past the min-rest window so the bet is eligible.
    const { entries } = m.listOpenChallenges('tcgame', 'bob', Date.now() + 6_000);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ matchId: w.matchId, timeControlId: 'slow' });
  });

  it('taking a resting challenge inherits the owner control (intrinsic to the match)', () => {
    const { m } = mm();
    const w = m.joinQueue('alice', 'tcgame', 50, 'slow');
    if (w.status !== 'waiting') throw new Error('expected waiting');
    const r = m.takeChallenge('bob', w.matchId);
    expect(clockOfMatch(m, r.matchId).timeControlId).toBe('slow');
    expect(clockOfMatch(m, r.matchId).remainingMs['bob']).toBe(20_000);
  });
});
