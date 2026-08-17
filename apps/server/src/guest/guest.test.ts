import { describe, it, expect } from 'vitest';
import { GUEST_BOT_STAKE_LANES } from '@rapidclash/shared';
import { coinflipModule } from '@rapidclash/game-coinflip';
import { createGuestServices, mintGuestId, isGuestId, DEMO_BOT_COINFLIP_IDS } from './index.js';

// Issue #351 superseded the old single fixed-100 Coinflip bot with one bot-waiter identity PER
// stake lane in GUEST_BOT_STAKE_LANES.coinflip ([5, 10, 25, 50] as of #350) — these tests exercise
// one representative lane (the first configured stake) unless a test is specifically about
// multiple lanes coexisting.
const STAKE = GUEST_BOT_STAKE_LANES.coinflip[0];
const OTHER_STAKE = GUEST_BOT_STAKE_LANES.coinflip[1];

describe('guest services', () => {
  it('the Demo-Opponent is already resting at startup — the first guest pairs instantly', () => {
    const { ledger, matchmaking } = createGuestServices();
    ledger.grant('guest:a');
    const r = matchmaking.joinQueue('guest:a', 'coinflip', STAKE);
    expect(r.status).toBe('matched');
    if (r.status === 'matched') expect(r.opponentId).toBe(DEMO_BOT_COINFLIP_IDS[STAKE]);
  });

  it('every configured stake lane has its own resting bot at startup, simultaneously', () => {
    const { ledger, matchmaking } = createGuestServices();
    for (const stake of GUEST_BOT_STAKE_LANES.coinflip) {
      ledger.grant(`guest:${stake}`);
      const r = matchmaking.joinQueue(`guest:${stake}`, 'coinflip', stake);
      expect(r.status).toBe('matched');
      if (r.status === 'matched') expect(r.opponentId).toBe(DEMO_BOT_COINFLIP_IDS[stake]);
    }
  });

  it('after a match forms, onDemoBotMatched re-posts the bot so the NEXT guest also pairs instantly', () => {
    const { ledger, matchmaking, onDemoBotMatched } = createGuestServices();
    ledger.grant('guest:a');
    ledger.grant('guest:b');

    const r1 = matchmaking.joinQueue('guest:a', 'coinflip', STAKE);
    if (r1.status !== 'matched') throw new Error('expected matched');
    onDemoBotMatched(r1.matchId, 1_000_000);

    const r2 = matchmaking.joinQueue('guest:b', 'coinflip', STAKE);
    expect(r2.status).toBe('matched');
    if (r2.status === 'matched') {
      expect(r2.opponentId).toBe(DEMO_BOT_COINFLIP_IDS[STAKE]);
      expect(r2.matchId).not.toBe(r1.matchId);
    }
  });

  it("onDemoBotMatched submits the bot's own pick through the normal applyMove path (redacted from the guest pre-terminal)", () => {
    const { ledger, matchmaking, onDemoBotMatched } = createGuestServices();
    ledger.grant('guest:a');
    const r = matchmaking.joinQueue('guest:a', 'coinflip', STAKE);
    if (r.status !== 'matched') throw new Error('expected matched');
    onDemoBotMatched(r.matchId, 1_000_000);

    const match = matchmaking.getActiveMatch(r.matchId)!;
    const raw = match.state as { choices: Record<string, string> };
    expect(raw.choices[DEMO_BOT_COINFLIP_IDS[STAKE]]).toMatch(/^(heads|tails)$/); // the bot DID pick, server-side

    // The guest's own redacted view never carries the opponent's (the bot's) choice pre-terminal —
    // exercised at the module level directly, mirroring how the gateway calls viewFor.
    const redacted = coinflipModule.viewFor(match.state, 'guest:a') as { choices: Record<string, string> };
    expect(redacted.choices[DEMO_BOT_COINFLIP_IDS[STAKE]]).toBeUndefined();
  });

  it('two concurrent guests are fully isolated: separate balances, separate matches, neither sees the other', () => {
    const { ledger, matchmaking, onDemoBotMatched } = createGuestServices();
    ledger.grant('guest:a');
    ledger.grant('guest:b');
    ledger.escrow('guest:a', 'preexisting-a', 10);
    expect(ledger.getBalance('guest:a')).not.toBe(ledger.getBalance('guest:b'));

    const r1 = matchmaking.joinQueue('guest:a', 'coinflip', STAKE);
    if (r1.status !== 'matched') throw new Error('expected matched');
    onDemoBotMatched(r1.matchId, 1_000_000); // re-posts the bot so guest:b also pairs instantly

    const r2 = matchmaking.joinQueue('guest:b', 'coinflip', STAKE);
    if (r2.status !== 'matched') throw new Error('expected matched');
    expect(r1.matchId).not.toBe(r2.matchId);

    // Each guest's match state carries only ITS OWN players — no cross-visibility.
    expect(matchmaking.getActiveMatch(r1.matchId)!.players).toContain('guest:a');
    expect(matchmaking.getActiveMatch(r1.matchId)!.players).not.toContain('guest:b');
    expect(matchmaking.getActiveMatch(r2.matchId)!.players).toContain('guest:b');
    expect(matchmaking.getActiveMatch(r2.matchId)!.players).not.toContain('guest:a');
  });

  it('two guests posting DIFFERENT configured stakes pair with DIFFERENT bot identities, concurrently, with no cross-lane interference', () => {
    const { ledger, matchmaking, onDemoBotMatched } = createGuestServices();
    ledger.grant('guest:cheap');
    ledger.grant('guest:pricier');

    const r1 = matchmaking.joinQueue('guest:cheap', 'coinflip', STAKE);
    const r2 = matchmaking.joinQueue('guest:pricier', 'coinflip', OTHER_STAKE);
    if (r1.status !== 'matched' || r2.status !== 'matched') throw new Error('expected both matched instantly');

    expect(r1.opponentId).toBe(DEMO_BOT_COINFLIP_IDS[STAKE]);
    expect(r2.opponentId).toBe(DEMO_BOT_COINFLIP_IDS[OTHER_STAKE]);
    expect(r1.opponentId).not.toBe(r2.opponentId);
    expect(r1.matchId).not.toBe(r2.matchId);

    onDemoBotMatched(r1.matchId, 1_000_000);
    onDemoBotMatched(r2.matchId, 1_000_000);

    // Each lane's bot re-rests independently, at its OWN stake only.
    ledger.grant('guest:cheap-2');
    const r3 = matchmaking.joinQueue('guest:cheap-2', 'coinflip', STAKE);
    expect(r3.status).toBe('matched');
    if (r3.status === 'matched') expect(r3.opponentId).toBe(DEMO_BOT_COINFLIP_IDS[STAKE]);
  });

  it('guest matches never touch the real ledger — grant only landed in the ephemeral one', () => {
    const { ledger } = createGuestServices();
    const id = mintGuestId();
    ledger.grant(id);
    // GUEST_HUMAN_RESERVED_STAKE (1) aside, the grant amount is independent of #351's bot pools —
    // just confirming the ephemeral ledger (not the real one) is what's checked here.
    expect(ledger.getBalance(id)).toBeGreaterThan(0);
  });

  describe('usernameFor', () => {
    it('labels the bot honestly and a guest generically, never asking the real identity layer', () => {
      const { usernameFor } = createGuestServices();
      expect(usernameFor(DEMO_BOT_COINFLIP_IDS[STAKE])).toBe('Demo Opponent 🤖');
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

    // Total resting entries posted at construction across ALL curated games/lanes (issue #351):
    // one Coinflip identity per lane, plus one idle Chess pool slot and one idle Blackjack pool
    // slot PER lane (only the first idle sibling of each pool rests at once, per lane).
    const laneCount = GUEST_BOT_STAKE_LANES.coinflip.length;
    const EXPECTED_RESTING_AT_STARTUP =
      GUEST_BOT_STAKE_LANES.coinflip.length + GUEST_BOT_STAKE_LANES.chess.length + GUEST_BOT_STAKE_LANES.blackjack.length;

    it("the bot's resting entries actually expire once idle past the TTL, and the lockout is real (reproduces the bug)", () => {
      let clock = 1_000_000;
      const { ledger, matchmaking } = createGuestServices({ now: () => clock, ttlMs: TTL });

      clock += TTL - 1;
      expect(matchmaking.sweepExpired(clock)).toEqual([]); // not yet — still resting
      clock += 1;
      const expired = matchmaking.sweepExpired(clock);
      // All bots across every curated game and every stake lane were posted at the same `now`
      // and share the same ttlMs, so they all expire together here.
      expect(expired).toHaveLength(EXPECTED_RESTING_AT_STARTUP);
      expect(expired.map((e) => e.ownerId)).toContain(DEMO_BOT_COINFLIP_IDS[STAKE]);

      // With the bots gone and NOTHING re-posting them (the old, buggy behaviour: only
      // onDemoBotMatched re-posts, and it can never fire with no bot left to pair against), a
      // guest now rests instead of matching — the permanent-lockout symptom seen in production.
      ledger.grant('guest:locked-out');
      const stuck = matchmaking.joinQueue('guest:locked-out', 'coinflip', STAKE);
      expect(stuck.status).toBe('waiting');
    });

    it('ensureDemoBotResting self-heals the lockout: called on an idle expiry (as the periodic sweep would, before any guest even tries), a guest afterwards still pairs instantly', () => {
      let clock = 1_000_000;
      const { ledger, matchmaking, ensureDemoBotResting } = createGuestServices({ now: () => clock, ttlMs: TTL });

      // The bots sat idle (no guest joined) long enough to expire — the exact production
      // scenario: nobody played for 90s+, sweepExpired removed every resting entry.
      clock += TTL + 1;
      expect(matchmaking.sweepExpired(clock)).toHaveLength(EXPECTED_RESTING_AT_STARTUP);

      // This is what gateway.ts's periodic sweep now calls every tick, independent of match
      // activity — the fix. In production this runs ~1s after the expiry, well before any real
      // guest is likely mid-PLAY.
      ensureDemoBotResting();

      // Only NOW does a guest try PLAY — proving the self-heal actually re-posted the bot (not
      // merely that a fresh createGuestServices() call starts with it resting, which the "first
      // guest pairs instantly" test above already covers separately).
      ledger.grant('guest:healed');
      const healed = matchmaking.joinQueue('guest:healed', 'coinflip', STAKE);
      expect(healed.status).toBe('matched');
      if (healed.status === 'matched') expect(healed.opponentId).toBe(DEMO_BOT_COINFLIP_IDS[STAKE]);
    });

    it('a guest already stuck waiting when the sweep re-asserts the bot is matched immediately too (the sweep-driven re-post pairs through the ordinary FIFO path, not a special case)', () => {
      let clock = 1_000_000;
      const { ledger, matchmaking, ensureDemoBotResting } = createGuestServices({ now: () => clock, ttlMs: TTL });

      clock += TTL + 1;
      expect(matchmaking.sweepExpired(clock)).toHaveLength(EXPECTED_RESTING_AT_STARTUP);

      // A guest happened to hit PLAY DURING the outage window — finds nobody resting, so it
      // rests itself (the "stuck" symptom).
      ledger.grant('guest:was-stuck');
      const stuck = matchmaking.joinQueue('guest:was-stuck', 'coinflip', STAKE);
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
      expect(formed!.players).toContain(DEMO_BOT_COINFLIP_IDS[STAKE]);
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
      // One resting entry per Coinflip stake lane — no duplicates from the repeated calls.
      expect(entries).toHaveLength(laneCount);
      for (const entry of entries) expect(entry.ownerName).toBe('Demo Opponent 🤖');
    });
  });
});
