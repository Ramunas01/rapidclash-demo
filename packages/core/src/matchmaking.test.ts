import { describe, beforeEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import type { GameModule, GameState, PlayerId } from '@rapidclash/shared';
import { createLedger, createMatchmaking, GRANT_AMOUNT } from './index.js';

// ─── Minimal mock game module ─────────────────────────────────────────────────

const mockModule: GameModule = {
  meta: {
    id: 'mock',
    displayName: 'Mock Game',
    minPlayers: 2,
    maxPlayers: 2,
    ranking: { kind: 'win_rate' },
    bet: { minStake: 10, maxStake: 500, symmetricStake: true },
    averageDurationSec: 5,
  },
  init: (players: PlayerId[]) => ({ players }),
  legalMoves: () => [],
  applyMove: (state: GameState) => ({ state, events: [] }),
  isTerminal: () => false,
  outcome: () => ({ type: 'draw' }),
  viewFor: (state: GameState) => state,
  forfeit: (state: GameState) => state,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setup() {
  const db = new Database(':memory:');
  const ledger = createLedger(db);
  const matchmaking = createMatchmaking(ledger, [mockModule]);
  return { ledger, matchmaking };
}

function grantAndJoin(
  ledger: ReturnType<typeof createLedger>,
  matchmaking: ReturnType<typeof createMatchmaking>,
  playerId: string,
  stake = 100,
) {
  ledger.grant(playerId);
  return matchmaking.joinQueue(playerId, 'mock', stake);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

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
      expect(r2.matchId).toBe(r1.matchId); // both share the canonical matchId
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
    // Do NOT grant — balance is 0
    expect(() => matchmaking.joinQueue('alice', 'mock', 100)).toThrow(/balance/i);
  });

  it('joining with a stake exactly equal to balance throws (after escrow is insufficient)', () => {
    ledger.grant('alice');
    // Use up most of the balance first
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
    // pot = 200; draw → each player refunded, no rake
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
