import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createLedger, createMatchmaking } from '@rapidclash/core';
import { chessModule } from '@rapidclash/game-chess';

// Live-smoke (real chess module + real core + real ledger): player-initiated draw offers
// (CHESS_DRAW_OFFER.md) routed through the generic core capability. Records an offer, completes the
// draw when both sides have offered (reusing the existing chess draw settlement — stakes returned,
// no rake, no rematch), and revokes a pending offer. Mirrors the WS gateway, which just broadcasts
// the returned state + settles when it turns terminal.

describe('chess draw offers — end-to-end (real chess module + core + ledger settlement)', () => {
  function setup(stake: number) {
    const clock = 1_000_000; // fixed injected clock — draw offers don't advance time
    const ledger = createLedger(new Database(':memory:'));
    const mm = createMatchmaking(ledger, [chessModule], undefined, { now: () => clock });
    ledger.grant('alice');
    ledger.grant('bob');
    mm.joinQueue('alice', 'chess', stake);
    const r = mm.joinQueue('bob', 'chess', stake);
    if (r.status !== 'matched') throw new Error('expected matched');
    return { ledger, mm, matchId: r.matchId };
  }
  const offersOf = (mm: ReturnType<typeof setup>['mm'], id: string) =>
    (mm.getActiveMatch(id)?.state as { drawOffers?: Record<string, number> } | undefined)?.drawOffers;

  it('a single offer is recorded (public state), match stays live — no settlement', () => {
    const { mm, matchId } = setup(100);
    const res = mm.offerDraw(matchId, 'alice');
    expect((res.state as { drawOffers?: Record<string, number> }).drawOffers?.['alice']).toBeGreaterThan(0);
    expect(offersOf(mm, matchId)?.['bob']).toBeUndefined();
    expect(chessModule.isTerminal(res.state)).toBe(false);
    expect(mm.getActiveMatch(matchId)).toBeDefined(); // not settled
  });

  it('both-offered completes the draw → settle: stakes returned, no rake, match removed', () => {
    const { ledger, mm, matchId } = setup(100);
    // Escrow debited on join: both at 900.
    expect(ledger.getBalance('alice')).toBe(900);
    expect(ledger.getBalance('bob')).toBe(900);

    mm.offerDraw(matchId, 'alice');
    const res = mm.offerDraw(matchId, 'bob'); // Bob offers while Alice is pending → draw completes
    expect(chessModule.isTerminal(res.state)).toBe(true);
    expect(chessModule.outcome(res.state)).toEqual({ type: 'draw' });

    const settled = mm.settleMatch(matchId);
    expect(settled.outcome).toEqual({ type: 'draw' });
    // Draw = refund both in full, no rake: delta 0 each, balances back to the 1000 grant.
    expect(settled.settlement['alice'].delta).toBe(0);
    expect(settled.settlement['bob'].delta).toBe(0);
    expect(ledger.getBalance('alice')).toBe(1000);
    expect(ledger.getBalance('bob')).toBe(1000);
    expect(mm.getActiveMatch(matchId)).toBeUndefined(); // settled + removed
  });

  it('revoke clears the sender own offer; the match stays live', () => {
    const { mm, matchId } = setup(100);
    mm.offerDraw(matchId, 'alice');
    expect(offersOf(mm, matchId)?.['alice']).toBeGreaterThan(0);
    mm.revokeDraw(matchId, 'alice');
    expect(offersOf(mm, matchId)?.['alice']).toBeUndefined();
    expect(mm.getActiveMatch(matchId)).toBeDefined();
  });

  it('offerDraw throws for a game that does not declare the capability', () => {
    // A stub module without `drawOffers` must be rejected by the generic router (no game-id branch).
    const ledger = createLedger(new Database(':memory:'));
    const stub = {
      ...chessModule,
      meta: { ...chessModule.meta, id: 'nodraw' },
      drawOffers: undefined,
    };
    const mm = createMatchmaking(ledger, [stub], undefined, { now: () => 1000 });
    ledger.grant('alice');
    ledger.grant('bob');
    mm.joinQueue('alice', 'nodraw', 100);
    const r = mm.joinQueue('bob', 'nodraw', 100);
    if (r.status !== 'matched') throw new Error('expected matched');
    expect(() => mm.offerDraw(r.matchId, 'alice')).toThrow(/does not support draw offers/);
  });
});
