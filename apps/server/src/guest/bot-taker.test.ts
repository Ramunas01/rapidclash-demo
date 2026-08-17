import { describe, it, expect } from 'vitest';
import { GUEST_HUMAN_RESERVED_STAKE, isDemoBotId } from '@rapidclash/shared';
import { createGuestServices } from './index.js';

// Issue #352 (guest bot economy 3/5, `docs/COMMS/from-advisor/guest-mode-bot-economy.md` §C) —
// `takeGuestStake` is the mirror image of `onDemoBotMatched`: it claims a GUEST's own resting bet
// with a freshly-minted, single-use bot identity, for whatever stake a guest posts that finds
// nobody resting. Unit-level (no WS gateway) — `bot-taker.gateway.test.ts` in this directory
// covers the full delayed-claim flow over the real WS gateway.

// An off-lane, non-reserved stake — deliberately NOT one of GUEST_BOT_STAKE_LANES, so no bot-
// waiter rests here and `matchmaking.joinQueue` always returns 'waiting' for it.
const OFF_LANE_STAKE = 42;

describe('createGuestServices().takeGuestStake', () => {
  it('claims a guest-posted off-lane stake, forming a match against a freshly-minted, honestly-labelled bot identity', () => {
    const { ledger, matchmaking, usernameFor, takeGuestStake } = createGuestServices();
    ledger.grant('guest:a');

    const rested = matchmaking.joinQueue('guest:a', 'coinflip', OFF_LANE_STAKE);
    expect(rested.status).toBe('waiting');
    if (rested.status !== 'waiting') throw new Error('expected waiting');

    const taken = takeGuestStake(rested.matchId, 'coinflip', OFF_LANE_STAKE);
    expect(taken).toBeDefined();
    if (!taken) throw new Error('expected a formed match');
    expect(taken.status).toBe('matched');
    expect(taken.opponentId).toBe('guest:a'); // the guest is the "opponent" from the taker's perspective
    expect(taken.matchId).toBe(rested.matchId);

    const match = matchmaking.getActiveMatch(taken.matchId)!;
    const botId = match.players.find(isDemoBotId);
    expect(botId).toBeDefined();
    expect(botId!.startsWith('demo-bot:coinflip:taker:')).toBe(true);
    expect(usernameFor(botId!)).toBe('Demo Opponent 🤖'); // honestly labelled — no new copy
    expect(match.players).toContain('guest:a');
  });

  it('never claims GUEST_HUMAN_RESERVED_STAKE (1) — enforced in the matching logic itself, not merely by callers choosing not to ask', () => {
    const { ledger, matchmaking, takeGuestStake } = createGuestServices();
    ledger.grant('guest:human');

    const rested = matchmaking.joinQueue('guest:human', 'coinflip', GUEST_HUMAN_RESERVED_STAKE);
    expect(rested.status).toBe('waiting');
    if (rested.status !== 'waiting') throw new Error('expected waiting');

    const taken = takeGuestStake(rested.matchId, 'coinflip', GUEST_HUMAN_RESERVED_STAKE);
    expect(taken).toBeUndefined(); // refused outright — never even attempts takeChallenge

    // The guest's bet is still exactly where it was — nobody claimed it, nothing was consumed.
    const stillOpen = matchmaking.listOpenChallenges('coinflip', 'nobody', Date.now() + 6_000);
    expect(stillOpen.entries.some((e) => e.matchId === rested.matchId)).toBe(true);
    expect(matchmaking.getActiveMatch(rested.matchId)).toBeUndefined(); // no match ever formed
  });

  it('is a harmless no-op if the challenge is already gone by the time it runs (self-heals like every other sweep in this file)', () => {
    const { takeGuestStake } = createGuestServices();
    // No corresponding joinQueue ever happened for this matchId — the exact shape of "a real
    // human already took it, it expired, or the guest cancelled" by the time a delayed take fires.
    const taken = takeGuestStake('nonexistent-match-id', 'coinflip', OFF_LANE_STAKE);
    expect(taken).toBeUndefined();
  });

  it('works across every curated game, not just Coinflip', () => {
    const { ledger, matchmaking, takeGuestStake } = createGuestServices();
    for (const gameId of ['coinflip', 'chess', 'blackjack'] as const) {
      const guestId = `guest:${gameId}`;
      ledger.grant(guestId);
      const rested = matchmaking.joinQueue(guestId, gameId, OFF_LANE_STAKE, gameId === 'chess' ? 'blitz5' : undefined);
      expect(rested.status).toBe('waiting');
      if (rested.status !== 'waiting') throw new Error(`expected ${gameId} waiting`);

      const taken = takeGuestStake(rested.matchId, gameId, OFF_LANE_STAKE);
      expect(taken).toBeDefined();
      if (!taken) throw new Error(`expected ${gameId} taken`);
      const botId = matchmaking.getActiveMatch(taken.matchId)!.players.find(isDemoBotId);
      expect(botId!.startsWith(`demo-bot:${gameId}:taker:`)).toBe(true);
    }
  });

  it('two guests posting different off-lane stakes are each claimed by their OWN distinct taker identity — no cross-match identity sharing', () => {
    const { ledger, matchmaking, takeGuestStake } = createGuestServices();
    ledger.grant('guest:x');
    ledger.grant('guest:y');

    const r1 = matchmaking.joinQueue('guest:x', 'coinflip', 30);
    const r2 = matchmaking.joinQueue('guest:y', 'coinflip', 31);
    if (r1.status !== 'waiting' || r2.status !== 'waiting') throw new Error('expected both waiting');

    const t1 = takeGuestStake(r1.matchId, 'coinflip', 30);
    const t2 = takeGuestStake(r2.matchId, 'coinflip', 31);
    if (!t1 || !t2) throw new Error('expected both taken');

    expect(t1.matchId).not.toBe(t2.matchId);
    const bot1 = matchmaking.getActiveMatch(t1.matchId)!.players.find(isDemoBotId);
    const bot2 = matchmaking.getActiveMatch(t2.matchId)!.players.find(isDemoBotId);
    expect(bot1).not.toBe(bot2);
  });
});
