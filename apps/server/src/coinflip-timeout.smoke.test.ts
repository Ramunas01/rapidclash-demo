import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createLedger, createMatchmaking } from '@rapidclash/core';
import { coinflipModule } from '@rapidclash/game-coinflip';

// Live-smoke (real core + real coinflip module) of the opt-in this hub adds: coinflip now declares
// the generic per-player pick timer (`meta.moveTimeoutMs`) + a seeded `timeoutMove`, so a round
// where a player never picks still resolves — the server runs the authoritative clock, the client
// countdown is cosmetic. Proves coinflip is wired into the SAME generic sweep Keno/Limbo use, with
// no coinflip-specific core branch.

function setup(stake = 50) {
  let clock = 1_000_000;
  const ledger = createLedger(new Database(':memory:'));
  const mm = createMatchmaking(ledger, [coinflipModule], undefined, { now: () => clock });
  ledger.grant('alice');
  ledger.grant('bob');
  mm.joinQueue('alice', 'coinflip', stake);
  const r = mm.joinQueue('bob', 'coinflip', stake);
  if (r.status !== 'matched') throw new Error('expected matched');
  return { ledger, mm, matchId: r.matchId, advance: (ms: number) => { clock += ms; }, now: () => clock };
}

describe('coinflip — generic pick-timer wiring (server-authoritative auto-pick)', () => {
  it('declares the 10s pick timer', () => {
    expect(coinflipModule.meta.moveTimeoutMs).toBe(10_000);
  });

  it('a no-pick round auto-resolves: both pick clocks expire → seeded auto-pick → the round resolves or replays', () => {
    const { mm, matchId, advance, now } = setup();
    advance(10_001); // both players had a legal move from the start → both timers expire
    const res = mm.sweepTimedOutMoves(now());

    expect(res.map((r) => r.playerId)).toEqual(['alice', 'bob']); // both auto-picked (the no-show wiring)
    expect(res[0].terminal).toBe(false); // alice first (bob still pending)
    // bob's auto-pick is the resolving move: DIFFERENT sides → a decisive win (settled + removed);
    // SAME side → a tie, which the universal tie rule replays in the same escrow — never stuck.
    if (res[1].terminal) {
      expect(res[1].outcome!.type).toBe('win');
      expect(mm.getActiveMatch(matchId)).toBeUndefined();
    } else {
      expect(mm.getActiveMatch(matchId)).toBeDefined(); // replayed (a fresh seeded round)
    }
  });

  it('a real pick resets that player; only the no-show is auto-picked, and the round resolves or replays', () => {
    const { mm, matchId, advance, now } = setup();
    advance(5_000);
    mm.applyMove(matchId, 'alice', 'heads', now()); // alice picks within her window
    advance(6_000); // past bob's 10s deadline, before alice's (she already moved → no timer)
    const res = mm.sweepTimedOutMoves(now());

    expect(res.map((r) => r.playerId)).toEqual(['bob']); // only the no-show is auto-picked
    // bob auto-picks tails → decisive (settled); bob auto-picks heads → same as alice → tie → replay.
    if (res[0].terminal) {
      expect(res[0].outcome!.type).toBe('win');
      expect(mm.getActiveMatch(matchId)).toBeUndefined();
    } else {
      expect(mm.getActiveMatch(matchId)).toBeDefined();
    }
  });
});
