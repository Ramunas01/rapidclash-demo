// Tests for the gated taker's claiming rule (issue #362: exclude-stake + arbitrary-stake claiming;
// issue #368: exact-name allowlist replaced by `Demo*` username-prefix gating) and the funding
// check it depends on.
//
// Both `isTakeable` and `hasSufficientFunds` are pure functions exported from bot.ts specifically
// so this file can exercise them directly, without a live server/WS/HTTP connection — same
// "env-driven singleton config, reset the module registry per scenario" pattern config.test.ts
// already established, since both functions read the module-level `config` singleton.
//
// NOTE on `TAKER_ALLOW_PREFIX`'s default: unlike `TAKER_STAKE`/`TAKER_EXCLUDE_STAKE` (both
// "0 = disabled"), `config.ts` defaults `takerAllowPrefix` to `'Demo'`, not `''` (issue #368's
// explicit ask — zero Owner-provisioning step for a self-registered `Demo*` account). That means
// `isTakeable` is no longer ungated out of the box: any scenario below that wants the *fully*
// ungated general-roster behaviour must now pass `TAKER_ALLOW_PREFIX: ''` explicitly.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenChallenge } from '@rapidclash/shared';

const ORIGINAL_ENV = { ...process.env };

async function loadBot(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import('./bot.js');
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function challenge(overrides: Partial<OpenChallenge> = {}): OpenChallenge {
  return {
    matchId: 'm1',
    ownerName: 'Investor1',
    stake: 5,
    openedAt: 0,
    expiresAt: 0,
    timeControlId: 'none',
    ...overrides,
  };
}

describe('isTakeable — general (fully ungated) behaviour is unaffected', () => {
  it('claims a non-bot, non-reserved-stake challenge when prefix/stake/exclude are all disabled', async () => {
    const { isTakeable } = await loadBot({ TAKER_ALLOW_PREFIX: '' });
    expect(isTakeable(challenge({ ownerName: 'AnyHuman', stake: 25 }))).toBe(true);
  });

  it("never claims another bot's own posting (BOT_PREFIX), regardless of TAKER_ALLOW_PREFIX", async () => {
    vi.resetModules();
    const { BOT_PREFIX } = await import('./config.js');
    const { isTakeable } = await import('./bot.js');
    expect(isTakeable(challenge({ ownerName: `${BOT_PREFIX}SomeBot`, stake: 5 }))).toBe(false);
  });

  it('never claims a HUMAN_RESERVED_STAKE (100) challenge, gated or not', async () => {
    const { isTakeable } = await loadBot({ TAKER_ALLOW_PREFIX: '' });
    expect(isTakeable(challenge({ ownerName: 'AnyHuman', stake: 100 }))).toBe(false);
  });

  it('TAKER_EXCLUDE_STAKE defaults to 0 (no-op) — every non-reserved stake stays claimable', async () => {
    const { isTakeable } = await loadBot({ TAKER_EXCLUDE_STAKE: undefined, TAKER_ALLOW_PREFIX: '' });
    for (const stake of [1, 5, 10, 25, 50]) {
      expect(isTakeable(challenge({ ownerName: 'AnyHuman', stake }))).toBe(true);
    }
  });
});

describe('isTakeable — TAKER_ALLOW_PREFIX default (issue #368)', () => {
  it("defaults to 'Demo' — a self-registered Demo*-named account is claimed with zero config", async () => {
    const { isTakeable } = await loadBot({});
    expect(isTakeable(challenge({ ownerName: 'DemoAcmeCapital', stake: 25 }))).toBe(true);
    expect(isTakeable(challenge({ ownerName: 'Demo', stake: 25 }))).toBe(true); // the bare account itself
  });

  it("an account NOT starting with 'Demo' is never claimed by the default-gated taker", async () => {
    const { isTakeable } = await loadBot({});
    expect(isTakeable(challenge({ ownerName: 'AnyHuman', stake: 25 }))).toBe(false);
  });

  it('the match is case-sensitive — a lowercase "demo…" name does not qualify', async () => {
    const { isTakeable } = await loadBot({});
    expect(isTakeable(challenge({ ownerName: 'demoLowercase', stake: 25 }))).toBe(false);
  });
});

describe('isTakeable — gated mode (TAKER_ALLOW_PREFIX set, issue #368)', () => {
  it("claims a Demo*-prefixed account's non-excluded-stake post", async () => {
    const { isTakeable } = await loadBot({
      TAKER_ALLOW_PREFIX: 'Demo',
      TAKER_EXCLUDE_STAKE: '10',
    });
    expect(isTakeable(challenge({ ownerName: 'DemoInvestor1', stake: 5 }))).toBe(true);
    expect(isTakeable(challenge({ ownerName: 'DemoInvestor2', stake: 25 }))).toBe(true);
  });

  it("NEVER claims a Demo*-prefixed account's excluded-stake post — reserved for pairing with another Demo* account", async () => {
    const { isTakeable } = await loadBot({
      TAKER_ALLOW_PREFIX: 'Demo',
      TAKER_EXCLUDE_STAKE: '10',
    });
    expect(isTakeable(challenge({ ownerName: 'DemoInvestor1', stake: 10 }))).toBe(false);
    expect(isTakeable(challenge({ ownerName: 'DemoInvestor2', stake: 10 }))).toBe(false);
  });

  it("NEVER claims a non-Demo-prefixed account's posts at any stake — unchanged gating behaviour", async () => {
    const { isTakeable } = await loadBot({
      TAKER_ALLOW_PREFIX: 'Demo',
      TAKER_EXCLUDE_STAKE: '10',
    });
    for (const stake of [1, 5, 10, 25, 50]) {
      expect(isTakeable(challenge({ ownerName: 'SomeRandomRealPlayer', stake }))).toBe(false);
    }
  });

  it('claims ANY stake a Demo*-prefixed account posts (not just a fixed 1) except the excluded one and HUMAN_RESERVED_STAKE', async () => {
    const { isTakeable } = await loadBot({
      TAKER_ALLOW_PREFIX: 'Demo',
      TAKER_EXCLUDE_STAKE: '10',
    });
    for (const stake of [1, 5, 25, 50]) {
      expect(isTakeable(challenge({ ownerName: 'DemoInvestor1', stake }))).toBe(true);
    }
    expect(isTakeable(challenge({ ownerName: 'DemoInvestor1', stake: 10 }))).toBe(false); // excluded
    expect(isTakeable(challenge({ ownerName: 'DemoInvestor1', stake: 100 }))).toBe(false); // human-reserved
  });

  it('TAKER_STAKE, when also set, still narrows a gated taker to one exact stake', async () => {
    const { isTakeable } = await loadBot({
      TAKER_ALLOW_PREFIX: 'Demo',
      TAKER_STAKE: '5',
      TAKER_EXCLUDE_STAKE: '10',
    });
    expect(isTakeable(challenge({ ownerName: 'DemoInvestor1', stake: 5 }))).toBe(true);
    expect(isTakeable(challenge({ ownerName: 'DemoInvestor1', stake: 25 }))).toBe(false);
  });

  it('a custom TAKER_ALLOW_PREFIX overrides the "Demo" default entirely', async () => {
    const { isTakeable } = await loadBot({ TAKER_ALLOW_PREFIX: 'Investor' });
    expect(isTakeable(challenge({ ownerName: 'InvestorAcme', stake: 5 }))).toBe(true);
    expect(isTakeable(challenge({ ownerName: 'DemoAcme', stake: 5 }))).toBe(false); // no longer matches
  });
});

describe('hasSufficientFunds — top-up threshold scales with the actual claimed stake (issue #362)', () => {
  it('uses BOT_LOW_BALANCE_FACTOR (default 5) × the given stake, not a fixed one', async () => {
    const { hasSufficientFunds } = await loadBot({});
    // default factor 5: balance >= stake * 5
    expect(hasSufficientFunds(1000, 50)).toBe(true); // 1000 >= 250
    expect(hasSufficientFunds(200, 50)).toBe(false); // 200 < 250
    expect(hasSufficientFunds(5, 1)).toBe(true); // 5 >= 5 (boundary, inclusive)
  });

  it('scales correctly across the new wider stake range up to just under HUMAN_RESERVED_STAKE', async () => {
    const { hasSufficientFunds } = await loadBot({});
    for (const stake of [1, 5, 10, 25, 50]) {
      expect(hasSufficientFunds(stake * 5, stake)).toBe(true); // exactly at threshold
      expect(hasSufficientFunds(stake * 5 - 1, stake)).toBe(false); // just under
    }
  });

  it('honours a BOT_LOW_BALANCE_FACTOR override', async () => {
    const { hasSufficientFunds } = await loadBot({ BOT_LOW_BALANCE_FACTOR: '2' });
    expect(hasSufficientFunds(100, 50)).toBe(true); // 100 >= 100
    expect(hasSufficientFunds(99, 50)).toBe(false);
  });
});
