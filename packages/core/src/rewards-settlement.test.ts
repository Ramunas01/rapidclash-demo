// End-to-end acceptance-criteria coverage for issue #306: settleMatch → the new
// `onPlayerSettled` hook → Rewards.recordMatchSettlement, through the REAL matchmaking
// pipeline (not calling Rewards directly), at both rake rates that exist in this repo.

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import type { GameModule, GameState, PlayerId, Outcome, ApplyResult } from '@rapidclash/shared';
import { createLedger, createMatchmaking, GRANT_AMOUNT } from './index.js';
import { createRewards } from './rewards.js';

// A minimal RPS-like module, parameterized on rakeRate/maxStake — same shape as
// matchmaking.test.ts's own rpsLikeModule, kept local so this file doesn't couple to that
// file's internals.
interface RpsState {
  players: [PlayerId, PlayerId];
  choices: Partial<Record<PlayerId, 'rock' | 'paper' | 'scissors'>>;
  forcedWinner?: PlayerId | 'draw';
}

function makeModule(id: string, rakeRate: number, maxStake = 500): GameModule {
  return {
    meta: {
      id,
      displayName: id,
      minPlayers: 2,
      maxPlayers: 2,
      ranking: { kind: 'win_rate' },
      bet: { minStake: 10, maxStake, symmetricStake: true },
      averageDurationSec: 5,
      rakeRate,
    },
    init: (players: PlayerId[]) => ({ players: [players[0], players[1]], choices: {} } as RpsState),
    legalMoves: (state: GameState, playerId: PlayerId) => {
      const s = state as RpsState;
      return playerId in s.choices || s.forcedWinner !== undefined ? [] : ['rock', 'paper', 'scissors'];
    },
    applyMove: (state: GameState, move: unknown, ctx): ApplyResult => {
      const s = state as RpsState;
      const newState: RpsState = {
        ...s,
        choices: { ...s.choices, [ctx.playerId]: move as 'rock' },
      };
      return { state: newState, events: [] };
    },
    isTerminal: (state: GameState) => {
      const s = state as RpsState;
      return s.forcedWinner !== undefined || s.players.every((p) => p in s.choices);
    },
    outcome: (state: GameState): Outcome => {
      const s = state as RpsState;
      if (s.forcedWinner === 'draw') return { type: 'draw' };
      if (s.forcedWinner) return { type: 'win', winner: s.forcedWinner };
      // Force a decisive winner deterministically for the test's own control (avoids needing
      // real rock/paper/scissors resolution logic here — outcome is forced via `forcedWinner`
      // set directly on state by the test, see `forceWin`/`forceDraw` below).
      return { type: 'draw' };
    },
    viewFor: (state: GameState) => state,
    forfeit: (state: GameState) => state,
  };
}

function setupMatch(mod: GameModule, stake: number) {
  const db = new Database(':memory:');
  const ledger = createLedger(db);
  const rewards = createRewards(db, ledger);
  const settled: Array<{ playerId: string; stake: number; feeRate: number; outcome: string }> = [];
  const matchmaking = createMatchmaking(ledger, [mod], undefined, {
    onPlayerSettled: (info) => {
      settled.push({ ...info });
      rewards.recordMatchSettlement(info.playerId, info.stake, info.feeRate, info.outcome);
    },
  });
  ledger.grant('alice');
  ledger.grant('bob');
  matchmaking.joinQueue('alice', mod.meta.id, stake);
  const r = matchmaking.joinQueue('bob', mod.meta.id, stake);
  if (r.status !== 'matched') throw new Error('expected matched');
  return { ledger, rewards, matchmaking, matchId: r.matchId, settled };
}

/** Force the given match's state to a decisive win for `winnerId` (bypasses needing real
 *  rock/paper/scissors play — this suite is testing the settlement→rewards pipeline, not RPS
 *  resolution, which is already covered by matchmaking.test.ts / packages/games/rps). */
function forceWin(matchmaking: ReturnType<typeof createMatchmaking>, matchId: string, winnerId: PlayerId): void {
  const match = matchmaking.getActiveMatch(matchId)!;
  (match.state as RpsState).forcedWinner = winnerId;
}

function forceDraw(matchmaking: ReturnType<typeof createMatchmaking>, matchId: string): void {
  const match = matchmaking.getActiveMatch(matchId)!;
  (match.state as RpsState).forcedWinner = 'draw';
}

describe('settleMatch → onPlayerSettled → Rewards (issue #306 acceptance criteria)', () => {
  it('a decisive win at 2.5% rake (the RPS/Coinflip/etc. rate) credits BOTH players XP from their own 100 RC stake', () => {
    const mod = makeModule('game-2.5pct', 0.025);
    const { matchmaking, matchId, rewards } = setupMatch(mod, 100);
    forceWin(matchmaking, matchId, 'alice');
    matchmaking.settleMatch(matchId);

    // notionalRake = 100*0.025 = 2.5; xp = round(40*2.5) = 100 — same for winner AND loser,
    // since each accrues from their OWN 100 RC stake (not a split of the platform's rake).
    expect(rewards.getSnapshot('alice').xpLifetime).toBe(100);
    expect(rewards.getSnapshot('bob').xpLifetime).toBe(100);
  });

  it('a decisive win at 10% rake (the Chess/Ships-Battle rate) credits both players proportionally more XP', () => {
    const mod = makeModule('game-10pct', 0.1);
    const { matchmaking, matchId, rewards } = setupMatch(mod, 100);
    forceWin(matchmaking, matchId, 'alice');
    matchmaking.settleMatch(matchId);

    // notionalRake = 100*0.1 = 10; xp = round(40*10) = 400
    expect(rewards.getSnapshot('alice').xpLifetime).toBe(400);
    expect(rewards.getSnapshot('bob').xpLifetime).toBe(400);
  });

  it('a 500 RC stake win credits diminished XP above the first 100 RC, through the real settlement path', () => {
    const mod = makeModule('game-500stake', 0.025, 500);
    const { matchmaking, matchId, rewards } = setupMatch(mod, 500);
    forceWin(matchmaking, matchId, 'alice');
    matchmaking.settleMatch(matchId);

    // notionalRake = 100*0.025 + 400*0.025*0.25 = 2.5 + 2.5 = 5; xp = round(40*5) = 200
    expect(rewards.getSnapshot('alice').xpLifetime).toBe(200);
    expect(rewards.getSnapshot('bob').xpLifetime).toBe(200);
  });

  it('a draw credits nothing to either player, through the real settlement path', () => {
    const mod = makeModule('game-draw', 0.1);
    const { matchmaking, matchId, rewards, ledger } = setupMatch(mod, 100);
    forceDraw(matchmaking, matchId);
    matchmaking.settleMatch(matchId);

    expect(rewards.getSnapshot('alice').xpLifetime).toBe(0);
    expect(rewards.getSnapshot('bob').xpLifetime).toBe(0);
    expect(rewards.getSnapshot('alice').claimableBalance).toBe(0);
    expect(rewards.getSnapshot('bob').claimableBalance).toBe(0);
    // Draws refund stake in full (ledger.ts) — confirms this test's draw is a real, decisive-free
    // settlement, not an artifact of a broken match.
    expect(ledger.getBalance('alice')).toBe(GRANT_AMOUNT);
    expect(ledger.getBalance('bob')).toBe(GRANT_AMOUNT);
  });

  it('settleMatch is idempotent — a second call (or forfeitMatch\'s internal re-settle) never double-accrues', () => {
    const mod = makeModule('game-idem', 0.1);
    const { matchmaking, matchId, rewards } = setupMatch(mod, 100);
    forceWin(matchmaking, matchId, 'alice');
    matchmaking.settleMatch(matchId);
    const xpAfterFirst = rewards.getSnapshot('alice').xpLifetime;

    matchmaking.settleMatch(matchId); // idempotent no-op — reuses the existing `completed` guard
    expect(rewards.getSnapshot('alice').xpLifetime).toBe(xpAfterFirst);
  });

  it('the onPlayerSettled hook reports the outcome/stake/feeRate the module declared, for both players', () => {
    const mod = makeModule('game-hookinfo', 0.1);
    const { matchmaking, matchId, settled } = setupMatch(mod, 100);
    forceWin(matchmaking, matchId, 'alice');
    matchmaking.settleMatch(matchId);

    expect(settled).toHaveLength(2);
    expect(settled.map((s) => s.playerId).sort()).toEqual(['alice', 'bob']);
    for (const s of settled) {
      expect(s.stake).toBe(100);
      expect(s.feeRate).toBe(0.1);
      expect(s.outcome).toBe('win');
    }
  });
});
