import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createLedger, createMatchmaking } from '@rapidclash/core';
import { coinflipModule, PICK_WINDOW_MS } from '@rapidclash/game-coinflip';

// Live-smoke (real core + real coinflip module) of the timer-only-resolve model (#164): coinflip
// runs a FIXED pick window as a generic absolute scheduled deadline (`launch` + `scheduledDeadlines`
// + a seeded `timeoutMove`), NOT a per-move budget. The round resolves ONLY at the shared window
// close — never on "both chosen" — and both picks lock simultaneously via the same generic sweep
// Crash uses, with no coinflip-specific core branch.

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

describe('coinflip — fixed-window timer-only-resolve wiring', () => {
  it('runs a FIXED absolute window, not a per-move budget (no moveTimeoutMs)', () => {
    expect(coinflipModule.meta.moveTimeoutMs).toBeUndefined();
    expect(typeof coinflipModule.launch).toBe('function');
    expect(typeof coinflipModule.scheduledDeadlines).toBe('function');
  });

  it('does NOT resolve before the window even when BOTH pick immediately (no early start)', () => {
    const { mm, matchId, advance, now } = setup();
    mm.applyMove(matchId, 'alice', 'heads', now());
    mm.applyMove(matchId, 'bob', 'tails', now()); // both chose in the first instant, different sides
    expect(mm.getActiveMatch(matchId)).toBeDefined(); // still live — the timer has not fired

    advance(1_000); // well inside the 10s window
    expect(mm.sweepTimedOutMoves(now())).toEqual([]); // nothing locks before the window closes
    expect(mm.getActiveMatch(matchId)).toBeDefined();

    // The window close is what locks + resolves.
    advance(PICK_WINDOW_MS); // now past windowEndsAt
    const res = mm.sweepTimedOutMoves(now());
    expect(res.map((r) => r.playerId)).toEqual(['alice', 'bob']); // both locked at the shared deadline
    expect(res[1].terminal).toBe(true); // different sides → decisive on the 2nd lock
    expect(res[1].outcome!.type).toBe('win');
    expect(mm.getActiveMatch(matchId)).toBeUndefined(); // settled + removed
  });

  it('a re-pick before the window is honoured: the sweep locks the LATEST pick (not an auto-pick)', () => {
    const { mm, matchId, advance, now } = setup();
    mm.applyMove(matchId, 'alice', 'heads', now());
    mm.applyMove(matchId, 'alice', 'tails', now()); // alice changes her mind — picks are mutable
    advance(PICK_WINDOW_MS + 1);
    const res = mm.sweepTimedOutMoves(now());
    // alice's locked side is her LATEST pick; the terminal state reveals both choices.
    const terminal = res.find((r) => r.terminal);
    const state = (terminal ?? res[res.length - 1]).state as { choices?: Record<string, string> };
    if (terminal) expect(state.choices!.alice).toBe('tails');
    expect(res.map((r) => r.playerId)).toEqual(['alice', 'bob']);
  });

  it('a NO-PICK round auto-resolves at the deadline: both seeded auto-picks lock → decisive or replay', () => {
    const { mm, matchId, advance, now } = setup();
    advance(PICK_WINDOW_MS + 1); // neither picked → both ride to the shared window close
    const res = mm.sweepTimedOutMoves(now());

    expect(res.map((r) => r.playerId)).toEqual(['alice', 'bob']);
    expect(res[0].terminal).toBe(false); // alice locks first (bob still pending)
    if (res[1].terminal) {
      expect(res[1].outcome!.type).toBe('win'); // auto-picks differed → decisive
      expect(mm.getActiveMatch(matchId)).toBeUndefined();
    } else {
      expect(mm.getActiveMatch(matchId)).toBeDefined(); // auto-picks matched → tie → replayed
    }
  });
});
