import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createLedger, createMatchmaking } from '@rapidclash/core';
import { chessModule } from '@rapidclash/game-chess';
import type { PlayerClocks } from '@rapidclash/shared';

// Live-smoke (real chess module + core): pairing on (game, stake, time-control) with the chess
// default control, and a resting chess challenge (what the bot crowd posts) being joinable.

describe('chess time control — matchmaking pairing (real chess module)', () => {
  function setup() {
    const ledger = createLedger(new Database(':memory:'));
    const mm = createMatchmaking(ledger, [chessModule]);
    for (const p of ['alice', 'bob', 'carol']) ledger.grant(p);
    return { ledger, mm };
  }
  const clockOf = (mm: ReturnType<typeof setup>['mm'], id: string) =>
    (mm.getActiveMatch(id)!.state as { clock: PlayerClocks }).clock;

  it('two players at the same stake + default control are matched and clocked (10 min)', () => {
    const { mm } = setup();
    expect(mm.joinQueue('alice', 'chess', 10).status).toBe('waiting'); // no control → default rapid10
    const r = mm.joinQueue('bob', 'chess', 10, 'rapid10');
    expect(r.status).toBe('matched');
    if (r.status === 'matched') {
      const c = clockOf(mm, r.matchId);
      expect(c.timeControlId).toBe('rapid10');
      expect(c.remainingMs['alice']).toBe(600_000); // the default 10-minute budget
      expect(c.remainingMs['bob']).toBe(600_000);
    }
  });

  it('the same stake but different controls do NOT pair (three-way pool split)', () => {
    const { mm } = setup();
    expect(mm.joinQueue('alice', 'chess', 10, 'rapid10').status).toBe('waiting');
    expect(mm.joinQueue('bob', 'chess', 10, 'blitz5').status).toBe('waiting'); // separate pool
    const r = mm.joinQueue('carol', 'chess', 10, 'blitz5');
    expect(r.status).toBe('matched'); // pairs with bob's blitz5, not alice's rapid10
    if (r.status === 'matched') {
      expect(r.opponentId).toBe('bob');
      expect(clockOf(mm, r.matchId).remainingMs['carol']).toBe(300_000); // blitz5 = 5 min
    }
  });

  it("a bot-style resting chess challenge (rapid10) is joinable, and the feed shows its control", () => {
    const { mm } = setup();
    const w = mm.joinQueue('alice', 'chess', 5, 'rapid10'); // the bot crowd's chess rester
    expect(w.status).toBe('waiting');
    if (w.status !== 'waiting') return;
    expect(w.timeControlId).toBe('rapid10');

    // It appears in the feed with its control (past the min-rest window).
    const { entries } = mm.listOpenChallenges('chess', 'bob', Date.now() + 6_000);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ matchId: w.matchId, timeControlId: 'rapid10' });

    // A human takes it → matched + clocked at the owner's control.
    const r = mm.takeChallenge('bob', w.matchId);
    expect(clockOf(mm, r.matchId).timeControlId).toBe('rapid10');
    expect(clockOf(mm, r.matchId).remainingMs['bob']).toBe(600_000);
  });

  it('an explicit unknown control is rejected', () => {
    const { mm } = setup();
    expect(() => mm.joinQueue('alice', 'chess', 10, 'hyperbullet')).toThrow(RangeError);
  });
});
