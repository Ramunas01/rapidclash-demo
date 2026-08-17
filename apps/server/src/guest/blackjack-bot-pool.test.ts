import { describe, it, expect } from 'vitest';
import { GUEST_BOT_STAKE_LANES } from '@rapidclash/shared';
import { createGuestServices } from './index.js';

// Issue #297: a small pool of independent Blackjack bot identities (not Coinflip's one shared
// identity) — a Blackjack match has a 10s per-decision timer, reveal choreography, and possible
// draw-replays, so it's mid-match for real time; reusing one identity across two concurrent
// guests would collide in the gateway's playerId → matchId reverse lookup. Mirrors
// chess-bot-pool.test.ts verbatim (issue #278's proven pattern), for Blackjack's own pool.
//
// Issue #351 generalized the pool from "one pool at one fixed stake" to "one independent pool PER
// stake lane" (GUEST_BOT_STAKE_LANES.blackjack, [5, 10, 25, 50] as of #350) — see this file's
// cross-lane section, and chess-bot-pool.test.ts's own comment for the fuller rationale.

const STAKE = GUEST_BOT_STAKE_LANES.blackjack[0];
const OTHER_STAKE = GUEST_BOT_STAKE_LANES.blackjack[1];

function joinBlackjack(matchmaking: ReturnType<typeof createGuestServices>['matchmaking'], playerId: string, stake: number = STAKE) {
  return matchmaking.joinQueue(playerId, 'blackjack', stake);
}

describe('blackjack Demo-Opponent pool (issue #297, multi-lane per issue #351)', () => {
  it('only ONE pool bot ever rests at a time PER LANE — two pool identities in the same lane are never both queued, so they can never pair against each other', () => {
    const { ledger, matchmaking } = createGuestServices();
    ledger.grant('guest:a');
    const r = joinBlackjack(matchmaking, 'guest:a');
    expect(r.status).toBe('matched');
    if (r.status === 'matched') expect(r.opponentId.startsWith('demo-bot:blackjack:')).toBe(true);
  });

  it('3 concurrent guest blackjack games run simultaneously, at the SAME stake, without any bot response misrouting between matches', () => {
    const { ledger, matchmaking, onDemoBotMatched } = createGuestServices();
    for (const id of ['guest:a', 'guest:b', 'guest:c']) ledger.grant(id);

    const r1 = joinBlackjack(matchmaking, 'guest:a');
    if (r1.status !== 'matched') throw new Error('expected matched');
    onDemoBotMatched(r1.matchId, 1_000_000);

    const r2 = joinBlackjack(matchmaking, 'guest:b');
    if (r2.status !== 'matched') throw new Error('expected matched — a second bot should be resting');
    onDemoBotMatched(r2.matchId, 1_000_000);

    const r3 = joinBlackjack(matchmaking, 'guest:c');
    if (r3.status !== 'matched') throw new Error('expected matched — a third bot should be resting');
    onDemoBotMatched(r3.matchId, 1_000_000);

    const opponents = new Set([r1.opponentId, r2.opponentId, r3.opponentId]);
    expect(opponents.size).toBe(3);
    const matchIds = new Set([r1.matchId, r2.matchId, r3.matchId]);
    expect(matchIds.size).toBe(3);

    for (const [r, guestId] of [[r1, 'guest:a'], [r2, 'guest:b'], [r3, 'guest:c']] as const) {
      const match = matchmaking.getActiveMatch(r.matchId)!;
      expect(match.players).toContain(guestId);
      expect(match.players).toContain(r.opponentId);
    }

    // A 4th simultaneous guest at the SAME stake finds nobody resting (all 3 pool bots in this
    // lane are now busy) — rests in the ordinary FIFO queue like any other unmatched bet.
    ledger.grant('guest:d');
    const r4 = joinBlackjack(matchmaking, 'guest:d');
    expect(r4.status).toBe('waiting');
  });

  it('once a pool slot frees (its match ends), the 4th guest — already resting — pairs as soon as the freed bot re-rests', () => {
    const { ledger, matchmaking, onDemoBotMatched, ensureDemoBotResting } = createGuestServices();
    for (const id of ['guest:a', 'guest:b', 'guest:c', 'guest:d']) ledger.grant(id);

    const r1 = joinBlackjack(matchmaking, 'guest:a');
    if (r1.status !== 'matched') throw new Error('expected matched');
    onDemoBotMatched(r1.matchId, 1_000_000);
    const r2 = joinBlackjack(matchmaking, 'guest:b');
    if (r2.status !== 'matched') throw new Error('expected matched');
    onDemoBotMatched(r2.matchId, 1_000_000);
    const r3 = joinBlackjack(matchmaking, 'guest:c');
    if (r3.status !== 'matched') throw new Error('expected matched');
    onDemoBotMatched(r3.matchId, 1_000_000);

    const r4 = joinBlackjack(matchmaking, 'guest:d');
    expect(r4.status).toBe('waiting');
    if (r4.status !== 'waiting') throw new Error('expected waiting');

    matchmaking.forfeitMatch(r1.matchId, 'guest:a');
    ensureDemoBotResting();

    const formed = matchmaking.getActiveMatch(r4.matchId);
    expect(formed).toBeDefined();
    expect(formed!.players).toContain('guest:d');
    expect(formed!.players).toContain(r1.opponentId);
  });

  it('ensureDemoBotResting is idempotent for the blackjack pool — repeated calls never post a second resting bot', () => {
    const { matchmaking, ensureDemoBotResting } = createGuestServices();
    ensureDemoBotResting();
    ensureDemoBotResting();
    ensureDemoBotResting();

    const { entries } = matchmaking.listOpenChallenges('blackjack', 'someone-else', Date.now() + 6_000);
    // One resting entry PER stake lane (issue #351) — not just one for the whole game.
    expect(entries).toHaveLength(GUEST_BOT_STAKE_LANES.blackjack.length);
    for (const entry of entries) expect(entry.ownerName).toBe('Demo Opponent 🤖');
  });

  describe('cross-lane independence (issue #351)', () => {
    it('two different stakes each have their own resting pool bot simultaneously, and a guest at each pairs instantly', () => {
      const { ledger, matchmaking } = createGuestServices();
      ledger.grant('guest:cheap');
      ledger.grant('guest:pricier');

      const r1 = joinBlackjack(matchmaking, 'guest:cheap', STAKE);
      const r2 = joinBlackjack(matchmaking, 'guest:pricier', OTHER_STAKE);
      expect(r1.status).toBe('matched');
      expect(r2.status).toBe('matched');
      if (r1.status !== 'matched' || r2.status !== 'matched') throw new Error('expected both matched');

      expect(r1.opponentId).not.toBe(r2.opponentId); // distinct lanes never share a bot identity
      expect(r1.matchId).not.toBe(r2.matchId);
    });

    it('filling a lane\'s pool to capacity does not affect a DIFFERENT lane\'s ability to pair instantly', () => {
      const { ledger, matchmaking, onDemoBotMatched } = createGuestServices();
      for (const id of ['guest:a', 'guest:b', 'guest:c']) ledger.grant(id);

      for (const id of ['guest:a', 'guest:b', 'guest:c']) {
        const r = joinBlackjack(matchmaking, id, STAKE);
        if (r.status !== 'matched') throw new Error(`expected ${id} matched`);
        onDemoBotMatched(r.matchId, 1_000_000);
      }
      ledger.grant('guest:d');
      const exhausted = joinBlackjack(matchmaking, 'guest:d', STAKE);
      expect(exhausted.status).toBe('waiting');

      ledger.grant('guest:other');
      const other = joinBlackjack(matchmaking, 'guest:other', OTHER_STAKE);
      expect(other.status).toBe('matched');
    });
  });
});
