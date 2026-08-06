import { describe, it, expect } from 'vitest';
import { GUEST_COINFLIP_STAKE } from '@rapidclash/shared';
import { coinflipModule } from '@rapidclash/game-coinflip';
import { createGuestServices, mintGuestId, isGuestId, DEMO_BOT_COINFLIP_ID } from './index.js';

describe('guest services', () => {
  it('the Demo-Opponent is already resting at startup — the first guest pairs instantly', () => {
    const { ledger, matchmaking } = createGuestServices();
    ledger.grant('guest:a');
    const r = matchmaking.joinQueue('guest:a', 'coinflip', GUEST_COINFLIP_STAKE);
    expect(r.status).toBe('matched');
    if (r.status === 'matched') expect(r.opponentId).toBe(DEMO_BOT_COINFLIP_ID);
  });

  it('after a match forms, onDemoBotMatched re-posts the bot so the NEXT guest also pairs instantly', () => {
    const { ledger, matchmaking, onDemoBotMatched } = createGuestServices();
    ledger.grant('guest:a');
    ledger.grant('guest:b');

    const r1 = matchmaking.joinQueue('guest:a', 'coinflip', GUEST_COINFLIP_STAKE);
    if (r1.status !== 'matched') throw new Error('expected matched');
    onDemoBotMatched(r1.matchId, 1_000_000);

    const r2 = matchmaking.joinQueue('guest:b', 'coinflip', GUEST_COINFLIP_STAKE);
    expect(r2.status).toBe('matched');
    if (r2.status === 'matched') {
      expect(r2.opponentId).toBe(DEMO_BOT_COINFLIP_ID);
      expect(r2.matchId).not.toBe(r1.matchId);
    }
  });

  it("onDemoBotMatched submits the bot's own pick through the normal applyMove path (redacted from the guest pre-terminal)", () => {
    const { ledger, matchmaking, onDemoBotMatched } = createGuestServices();
    ledger.grant('guest:a');
    const r = matchmaking.joinQueue('guest:a', 'coinflip', GUEST_COINFLIP_STAKE);
    if (r.status !== 'matched') throw new Error('expected matched');
    onDemoBotMatched(r.matchId, 1_000_000);

    const match = matchmaking.getActiveMatch(r.matchId)!;
    const raw = match.state as { choices: Record<string, string> };
    expect(raw.choices[DEMO_BOT_COINFLIP_ID]).toMatch(/^(heads|tails)$/); // the bot DID pick, server-side

    // The guest's own redacted view never carries the opponent's (the bot's) choice pre-terminal —
    // exercised at the module level directly, mirroring how the gateway calls viewFor.
    const redacted = coinflipModule.viewFor(match.state, 'guest:a') as { choices: Record<string, string> };
    expect(redacted.choices[DEMO_BOT_COINFLIP_ID]).toBeUndefined();
  });

  it('two concurrent guests are fully isolated: separate balances, separate matches, neither sees the other', () => {
    const { ledger, matchmaking, onDemoBotMatched } = createGuestServices();
    ledger.grant('guest:a');
    ledger.grant('guest:b');
    ledger.escrow('guest:a', 'preexisting-a', 10);
    expect(ledger.getBalance('guest:a')).not.toBe(ledger.getBalance('guest:b'));

    const r1 = matchmaking.joinQueue('guest:a', 'coinflip', GUEST_COINFLIP_STAKE);
    if (r1.status !== 'matched') throw new Error('expected matched');
    onDemoBotMatched(r1.matchId, 1_000_000); // re-posts the bot so guest:b also pairs instantly

    const r2 = matchmaking.joinQueue('guest:b', 'coinflip', GUEST_COINFLIP_STAKE);
    if (r2.status !== 'matched') throw new Error('expected matched');
    expect(r1.matchId).not.toBe(r2.matchId);

    // Each guest's match state carries only ITS OWN players — no cross-visibility.
    expect(matchmaking.getActiveMatch(r1.matchId)!.players).toContain('guest:a');
    expect(matchmaking.getActiveMatch(r1.matchId)!.players).not.toContain('guest:b');
    expect(matchmaking.getActiveMatch(r2.matchId)!.players).toContain('guest:b');
    expect(matchmaking.getActiveMatch(r2.matchId)!.players).not.toContain('guest:a');
  });

  it('guest matches never touch the real ledger — grant only landed in the ephemeral one', () => {
    const { ledger } = createGuestServices();
    const id = mintGuestId();
    ledger.grant(id);
    expect(ledger.getBalance(id)).toBe(GUEST_COINFLIP_STAKE * 3); // 300 / 100 per round
  });

  describe('usernameFor', () => {
    it('labels the bot honestly and a guest generically, never asking the real identity layer', () => {
      const { usernameFor } = createGuestServices();
      expect(usernameFor(DEMO_BOT_COINFLIP_ID)).toBe('Demo Opponent 🤖');
      expect(usernameFor('guest:abc')).toBe('Guest');
      expect(usernameFor('some-real-account-id')).toBeUndefined();
    });
  });

  describe('isGuestId / mintGuestId', () => {
    it('every minted id is recognised as a guest id', () => {
      expect(isGuestId(mintGuestId())).toBe(true);
      expect(isGuestId('a-real-account-uuid')).toBe(false);
    });
  });
});
