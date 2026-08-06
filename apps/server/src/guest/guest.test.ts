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

  describe('Demo-Opponent queue-expiry self-heal (production lockout, found post-#268)', () => {
    // The bot's resting entry is an ORDINARY joinQueue bet, so it carries the same TTL as any
    // real resting bet (default CHALLENGE_TTL_MS = 90s) — sweepExpired doesn't distinguish bot
    // from human. Reproduce with an injectable clock + a short ttlMs (mirrors
    // open-challenges.test.ts's `setup({ now, ttlMs })` pattern) instead of a real 90s wait.
    const TTL = 5_000;

    it("the bot's resting entry actually expires once idle past the TTL, and the lockout is real (reproduces the bug)", () => {
      let clock = 1_000_000;
      const { ledger, matchmaking } = createGuestServices({ now: () => clock, ttlMs: TTL });

      clock += TTL - 1;
      expect(matchmaking.sweepExpired(clock)).toEqual([]); // not yet — still resting
      clock += 1;
      const expired = matchmaking.sweepExpired(clock);
      // Issue #278 also seeds one chess pool bot resting at construction — both it and Coinflip's
      // bot were posted at the same `now` and share the same ttlMs, so both expire together here.
      expect(expired).toHaveLength(2);
      expect(expired.map((e) => e.ownerId)).toContain(DEMO_BOT_COINFLIP_ID);

      // With the bot gone and NOTHING re-posting it (the old, buggy behaviour: only
      // onDemoBotMatched re-posts, and it can never fire with no bot left to pair against), a
      // guest now rests instead of matching — the permanent-lockout symptom seen in production.
      ledger.grant('guest:locked-out');
      const stuck = matchmaking.joinQueue('guest:locked-out', 'coinflip', GUEST_COINFLIP_STAKE);
      expect(stuck.status).toBe('waiting');
    });

    it('ensureDemoBotResting self-heals the lockout: called on an idle expiry (as the periodic sweep would, before any guest even tries), a guest afterwards still pairs instantly', () => {
      let clock = 1_000_000;
      const { ledger, matchmaking, ensureDemoBotResting } = createGuestServices({ now: () => clock, ttlMs: TTL });

      // The bot sat idle (no guest joined) long enough to expire — the exact production
      // scenario: nobody played for 90s+, sweepExpired removed the bot's resting entry.
      clock += TTL + 1;
      expect(matchmaking.sweepExpired(clock)).toHaveLength(2); // Coinflip's bot + #278's chess pool slot

      // This is what gateway.ts's periodic sweep now calls every tick, independent of match
      // activity — the fix. In production this runs ~1s after the expiry, well before any real
      // guest is likely mid-PLAY.
      ensureDemoBotResting();

      // Only NOW does a guest try PLAY — proving the self-heal actually re-posted the bot (not
      // merely that a fresh createGuestServices() call starts with it resting, which the "first
      // guest pairs instantly" test above already covers separately).
      ledger.grant('guest:healed');
      const healed = matchmaking.joinQueue('guest:healed', 'coinflip', GUEST_COINFLIP_STAKE);
      expect(healed.status).toBe('matched');
      if (healed.status === 'matched') expect(healed.opponentId).toBe(DEMO_BOT_COINFLIP_ID);
    });

    it('a guest already stuck waiting when the sweep re-asserts the bot is matched immediately too (the sweep-driven re-post pairs through the ordinary FIFO path, not a special case)', () => {
      let clock = 1_000_000;
      const { ledger, matchmaking, ensureDemoBotResting } = createGuestServices({ now: () => clock, ttlMs: TTL });

      clock += TTL + 1;
      expect(matchmaking.sweepExpired(clock)).toHaveLength(2); // Coinflip's bot + #278's chess pool slot

      // A guest happened to hit PLAY DURING the outage window — finds nobody resting, so it
      // rests itself (the "stuck" symptom).
      ledger.grant('guest:was-stuck');
      const stuck = matchmaking.joinQueue('guest:was-stuck', 'coinflip', GUEST_COINFLIP_STAKE);
      expect(stuck.status).toBe('waiting');
      if (stuck.status !== 'waiting') throw new Error('expected waiting');

      // The next sweep tick re-asserts the bot — since a different player is already resting at
      // this exact queue key, ordinary FIFO pairing (matchmaking.ts, unchanged by this fix)
      // matches them immediately. No special "unstick the waiter" code needed. The resting
      // entry's own matchId becomes the canonical matchId once matched (matchmaking.ts's FIFO
      // contract), so it's the id to look the formed match up by.
      ensureDemoBotResting();
      const formed = matchmaking.getActiveMatch(stuck.matchId);
      expect(formed).toBeDefined();
      expect(formed!.players).toContain('guest:was-stuck');
      expect(formed!.players).toContain(DEMO_BOT_COINFLIP_ID);
    });

    it('ensureDemoBotResting is idempotent — repeated calls never duplicate the bot into two resting entries', () => {
      let clock = 1_000_000;
      const { matchmaking, ensureDemoBotResting } = createGuestServices({ now: () => clock });
      ensureDemoBotResting();
      ensureDemoBotResting();
      ensureDemoBotResting();

      // minRestMs (default 5s) gates listOpenChallenges — advance the clock so the entry (posted
      // at construction, unaffected by the later no-op calls) is old enough to be listed.
      clock += 6_000;
      const { entries } = matchmaking.listOpenChallenges('coinflip', 'someone-else', clock);
      expect(entries).toHaveLength(1);
      expect(entries[0].ownerName).toBe('Demo Opponent 🤖');
    });
  });
});
