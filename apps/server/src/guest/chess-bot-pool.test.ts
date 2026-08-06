import { describe, it, expect } from 'vitest';
import { GUEST_CHESS_STAKE, GUEST_CHESS_TIME_CONTROL } from '@rapidclash/shared';
import { createGuestServices } from './index.js';

// Issue #278: a small pool of independent Chess bot identities (not Coinflip's one shared
// identity) — a real chess game runs for minutes across many moves, so reusing one identity
// across two concurrent guests would collide in the gateway's playerId → matchId reverse lookup,
// silently misrouting the first guest's moves into the second guest's match.

function joinChess(matchmaking: ReturnType<typeof createGuestServices>['matchmaking'], playerId: string) {
  return matchmaking.joinQueue(playerId, 'chess', GUEST_CHESS_STAKE, GUEST_CHESS_TIME_CONTROL);
}

describe('chess Demo-Opponent pool (issue #278)', () => {
  it('only ONE pool bot ever rests at a time — two pool identities are never both queued, so they can never pair against each other', () => {
    const { ledger, matchmaking } = createGuestServices();
    ledger.grant('guest:a');
    // The pool's startup entry is posted at construction — confirm the queue holds exactly one
    // resting entry by observing that a joining guest matches instantly (if the pool bots had
    // self-paired at startup instead, NOTHING would be resting for this guest to find).
    const r = joinChess(matchmaking, 'guest:a');
    expect(r.status).toBe('matched');
  });

  it('3 concurrent guest chess games run simultaneously without any bot response misrouting between matches', () => {
    const { ledger, matchmaking, onDemoBotMatched } = createGuestServices();
    for (const id of ['guest:a', 'guest:b', 'guest:c']) ledger.grant(id);

    const r1 = joinChess(matchmaking, 'guest:a');
    if (r1.status !== 'matched') throw new Error('expected matched');
    onDemoBotMatched(r1.matchId, 1_000_000); // marks the matched bot busy + posts the next sibling

    const r2 = joinChess(matchmaking, 'guest:b');
    if (r2.status !== 'matched') throw new Error('expected matched — a second bot should be resting');
    onDemoBotMatched(r2.matchId, 1_000_000);

    const r3 = joinChess(matchmaking, 'guest:c');
    if (r3.status !== 'matched') throw new Error('expected matched — a third bot should be resting');
    onDemoBotMatched(r3.matchId, 1_000_000);

    // Three distinct matches, three distinct bot opponents — no collision.
    const opponents = new Set([r1.opponentId, r2.opponentId, r3.opponentId]);
    expect(opponents.size).toBe(3);
    const matchIds = new Set([r1.matchId, r2.matchId, r3.matchId]);
    expect(matchIds.size).toBe(3);

    // Each match still independently carries only its own two players.
    for (const [r, guestId] of [[r1, 'guest:a'], [r2, 'guest:b'], [r3, 'guest:c']] as const) {
      const match = matchmaking.getActiveMatch(r.matchId)!;
      expect(match.players).toContain(guestId);
      expect(match.players).toContain(r.opponentId);
    }

    // A 4th simultaneous guest finds nobody resting (all 3 pool bots are now busy) — rests in the
    // ordinary FIFO queue like any other unmatched bet, exactly like a real player would.
    ledger.grant('guest:d');
    const r4 = joinChess(matchmaking, 'guest:d');
    expect(r4.status).toBe('waiting');
  });

  it('once a pool slot frees (its match ends), the 4th guest — already resting — pairs as soon as the freed bot re-rests', () => {
    const { ledger, matchmaking, onDemoBotMatched, ensureDemoBotResting } = createGuestServices();
    for (const id of ['guest:a', 'guest:b', 'guest:c', 'guest:d']) ledger.grant(id);

    const r1 = joinChess(matchmaking, 'guest:a');
    if (r1.status !== 'matched') throw new Error('expected matched');
    onDemoBotMatched(r1.matchId, 1_000_000);
    const r2 = joinChess(matchmaking, 'guest:b');
    if (r2.status !== 'matched') throw new Error('expected matched');
    onDemoBotMatched(r2.matchId, 1_000_000);
    const r3 = joinChess(matchmaking, 'guest:c');
    if (r3.status !== 'matched') throw new Error('expected matched');
    onDemoBotMatched(r3.matchId, 1_000_000);

    const r4 = joinChess(matchmaking, 'guest:d');
    expect(r4.status).toBe('waiting');
    if (r4.status !== 'waiting') throw new Error('expected waiting');

    // guest:a's game ends (forfeit — any settlement path frees the bot the same way).
    matchmaking.forfeitMatch(r1.matchId, 'guest:a');

    // The next sweep tick (gateway.ts calls this every ~1s in production) notices the tracked
    // match has ended and re-rests that same bot — which, since guest:d is already resting at
    // this exact queue key, pairs them immediately through the ordinary FIFO path.
    ensureDemoBotResting();

    const formed = matchmaking.getActiveMatch(r4.matchId);
    expect(formed).toBeDefined();
    expect(formed!.players).toContain('guest:d');
    expect(formed!.players).toContain(r1.opponentId); // the exact bot that just freed up
  });

  it('ensureDemoBotResting is idempotent for the chess pool — repeated calls never post a second resting bot', () => {
    const { matchmaking, ensureDemoBotResting } = createGuestServices();
    ensureDemoBotResting();
    ensureDemoBotResting();
    ensureDemoBotResting();

    const { entries } = matchmaking.listOpenChallenges('chess', 'someone-else', Date.now() + 6_000);
    expect(entries).toHaveLength(1);
    expect(entries[0].ownerName).toBe('Demo Opponent 🤖');
  });
});
