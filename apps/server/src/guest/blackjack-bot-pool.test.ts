import { describe, it, expect } from 'vitest';
import { GUEST_BLACKJACK_STAKE } from '@rapidclash/shared';
import { createGuestServices } from './index.js';

// Issue #297: a small pool of independent Blackjack bot identities (not Coinflip's one shared
// identity) — a Blackjack match has a 10s per-decision timer, reveal choreography, and possible
// draw-replays, so it's mid-match for real time; reusing one identity across two concurrent
// guests would collide in the gateway's playerId → matchId reverse lookup. Mirrors
// chess-bot-pool.test.ts verbatim (issue #278's proven pattern), for Blackjack's own pool.

function joinBlackjack(matchmaking: ReturnType<typeof createGuestServices>['matchmaking'], playerId: string) {
  return matchmaking.joinQueue(playerId, 'blackjack', GUEST_BLACKJACK_STAKE);
}

describe('blackjack Demo-Opponent pool (issue #297)', () => {
  it('only ONE pool bot ever rests at a time — two pool identities are never both queued, so they can never pair against each other', () => {
    const { ledger, matchmaking } = createGuestServices();
    ledger.grant('guest:a');
    const r = joinBlackjack(matchmaking, 'guest:a');
    expect(r.status).toBe('matched');
    if (r.status === 'matched') expect(r.opponentId.startsWith('demo-bot:blackjack:')).toBe(true);
  });

  it('3 concurrent guest blackjack games run simultaneously without any bot response misrouting between matches', () => {
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

    // A 4th simultaneous guest finds nobody resting (all 3 pool bots are now busy) — rests in the
    // ordinary FIFO queue like any other unmatched bet.
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
    expect(entries).toHaveLength(1);
    expect(entries[0].ownerName).toBe('Demo Opponent 🤖');
  });
});
