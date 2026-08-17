import { describe, it, expect } from 'vitest';
import { GUEST_BOT_STAKE_LANES, GUEST_CHESS_TIME_CONTROL } from '@rapidclash/shared';
import { createGuestServices } from './index.js';

// Issue #278: a small pool of independent Chess bot identities (not Coinflip's one shared
// identity) — a real chess game runs for minutes across many moves, so reusing one identity
// across two concurrent guests would collide in the gateway's playerId → matchId reverse lookup,
// silently misrouting the first guest's moves into the second guest's match.
//
// Issue #351 generalized the pool from "one pool at one fixed stake" to "one independent pool PER
// stake lane" (GUEST_BOT_STAKE_LANES.chess, [5, 10, 25, 50] as of #350). These tests exercise one
// representative lane (STAKE) for the within-lane pool behaviour (unchanged reasoning from #278),
// plus a dedicated cross-lane section proving lanes never interfere with each other.

const STAKE = GUEST_BOT_STAKE_LANES.chess[0];
const OTHER_STAKE = GUEST_BOT_STAKE_LANES.chess[1];

function joinChess(matchmaking: ReturnType<typeof createGuestServices>['matchmaking'], playerId: string, stake: number = STAKE) {
  return matchmaking.joinQueue(playerId, 'chess', stake, GUEST_CHESS_TIME_CONTROL);
}

describe('chess Demo-Opponent pool (issue #278, multi-lane per issue #351)', () => {
  it('only ONE pool bot ever rests at a time PER LANE — two pool identities in the same lane are never both queued, so they can never pair against each other', () => {
    const { ledger, matchmaking } = createGuestServices();
    ledger.grant('guest:a');
    // The pool's startup entry is posted at construction — confirm the queue holds exactly one
    // resting entry by observing that a joining guest matches instantly (if the pool bots had
    // self-paired at startup instead, NOTHING would be resting for this guest to find).
    const r = joinChess(matchmaking, 'guest:a');
    expect(r.status).toBe('matched');
  });

  it('3 concurrent guest chess games run simultaneously, at the SAME stake, without any bot response misrouting between matches', () => {
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

    // A 4th simultaneous guest at the SAME stake finds nobody resting (all 3 pool bots in this
    // lane are now busy) — rests in the ordinary FIFO queue like any other unmatched bet, exactly
    // like a real player would.
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
    // One resting entry PER stake lane (issue #351) — not just one for the whole game.
    expect(entries).toHaveLength(GUEST_BOT_STAKE_LANES.chess.length);
    for (const entry of entries) expect(entry.ownerName).toBe('Demo Opponent 🤖');
  });

  describe('cross-lane independence (issue #351)', () => {
    it('two different stakes each have their own resting pool bot simultaneously, and a guest at each pairs instantly', () => {
      const { ledger, matchmaking } = createGuestServices();
      ledger.grant('guest:cheap');
      ledger.grant('guest:pricier');

      const r1 = joinChess(matchmaking, 'guest:cheap', STAKE);
      const r2 = joinChess(matchmaking, 'guest:pricier', OTHER_STAKE);
      expect(r1.status).toBe('matched');
      expect(r2.status).toBe('matched');
      if (r1.status !== 'matched' || r2.status !== 'matched') throw new Error('expected both matched');

      expect(r1.opponentId).not.toBe(r2.opponentId); // distinct lanes never share a bot identity
      expect(r1.matchId).not.toBe(r2.matchId);
    });

    it('filling a lane\'s pool to capacity does not affect a DIFFERENT lane\'s ability to pair instantly', () => {
      const { ledger, matchmaking, onDemoBotMatched } = createGuestServices();
      for (const id of ['guest:a', 'guest:b', 'guest:c']) ledger.grant(id);

      // Exhaust the STAKE lane's 3-bot pool.
      for (const id of ['guest:a', 'guest:b', 'guest:c']) {
        const r = joinChess(matchmaking, id, STAKE);
        if (r.status !== 'matched') throw new Error(`expected ${id} matched`);
        onDemoBotMatched(r.matchId, 1_000_000);
      }
      ledger.grant('guest:d');
      const exhausted = joinChess(matchmaking, 'guest:d', STAKE);
      expect(exhausted.status).toBe('waiting'); // this lane really is full

      // The OTHER lane is untouched — still pairs instantly.
      ledger.grant('guest:other');
      const other = joinChess(matchmaking, 'guest:other', OTHER_STAKE);
      expect(other.status).toBe('matched');
    });
  });
});
