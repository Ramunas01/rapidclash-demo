import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createLedger, createMatchmaking } from '@rapidclash/core';
import { chessModule } from '@rapidclash/game-chess';
import type { PlayerClocks } from '@rapidclash/shared';

// Live-smoke (real chess module + real core + real ledger, injected clock so it's fast and
// deterministic): a chess match runs the module's default 10-min cumulative control; one side
// lets the clock run to 0 → loses on time; the opponent settles pot − rake, exactly like any loss.

describe('chess time control — flag → loss-on-time (end-to-end with the real chess module)', () => {
  function setup(stake: number) {
    let clock = 1_000_000;
    const ledger = createLedger(new Database(':memory:'));
    const mm = createMatchmaking(ledger, [chessModule], undefined, { now: () => clock });
    ledger.grant('alice');
    ledger.grant('bob');
    mm.joinQueue('alice', 'chess', stake);
    const r = mm.joinQueue('bob', 'chess', stake);
    if (r.status !== 'matched') throw new Error('expected matched');
    return { ledger, mm, matchId: r.matchId, advance: (ms: number) => { clock += ms; }, now: () => clock };
  }
  const clockOf = (mm: ReturnType<typeof setup>['mm'], id: string) =>
    (mm.getActiveMatch(id)!.state as { clock: PlayerClocks }).clock;

  it('seeds the default 10-min budget for both sides, white to move', () => {
    const { mm, matchId } = setup(100);
    const c = clockOf(mm, matchId);
    expect(c.timeControlId).toBe('rapid10');
    expect(c.remainingMs['alice']).toBe(600_000); // white (first to join)
    expect(c.remainingMs['bob']).toBe(600_000);
    expect(c.active).toBe('alice');
  });

  it("black runs the clock to 0 after white moves → black loses on time; white settles pot − rake", () => {
    const { ledger, mm, matchId, advance, now } = setup(100);

    advance(5_000);
    mm.applyMove(matchId, 'alice', { from: 'e2', to: 'e4' }, now()); // white spends 5s, hands black the clock
    expect(clockOf(mm, matchId).active).toBe('bob');
    expect(clockOf(mm, matchId).remainingMs['alice']).toBe(595_000);

    // Black never moves; their full 10-min budget elapses → flag.
    advance(600_001);
    const resolved = mm.sweepTimedOutMoves(now());

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ playerId: 'bob', terminal: true });
    expect(resolved[0].outcome).toEqual({ type: 'win', winner: 'alice' });
    // Chess rake is 10%: pot = 200, rake = 20 → winner +80, loser −100.
    expect(resolved[0].settlement!['alice'].delta).toBe(80);
    expect(resolved[0].settlement!['bob'].delta).toBe(-100);
    // Final balances = the 1000-credit grant ± the settlement delta (stake was escrowed first).
    expect(ledger.getBalance('alice')).toBe(1080);
    expect(ledger.getBalance('bob')).toBe(900);
    expect(mm.getActiveMatch(matchId)).toBeUndefined(); // settled + removed
  });

  it('does not flag before the budget is spent; the 120s per-move deadline is OFF', () => {
    const { mm, matchId, advance, now } = setup(100);
    advance(130_000); // > 120s MATCH_TURN_TIMEOUT_MS but << the 10-min budget
    expect(mm.sweepStaleMatches(now())).toEqual([]); // clocked game is not forfeited by the per-match deadline
    expect(mm.sweepTimedOutMoves(now())).toEqual([]); // white still has budget
    expect(mm.getActiveMatch(matchId)).toBeDefined();
  });
});
