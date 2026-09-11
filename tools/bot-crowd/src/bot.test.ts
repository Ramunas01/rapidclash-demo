// Tests for the gated taker's claiming rule (issue #362: exclude-stake + arbitrary-stake claiming;
// issue #368: exact-name allowlist replaced by `Demo*` username-prefix gating) and the funding
// check it depends on. Also covers the top-up idempotency-key fix (issue #532).
//
// Both `isTakeable` and `hasSufficientFunds` are pure functions exported from bot.ts specifically
// so this file can exercise them directly, without a live server/WS/HTTP connection — same
// "env-driven singleton config, reset the module registry per scenario" pattern config.test.ts
// already established, since both functions read the module-level `config` singleton.
//
// NOTE on `TAKER_ALLOW_PREFIX`'s default: it's `''` (any human), same "disabled" sentinel as
// `TAKER_STAKE`/`TAKER_EXCLUDE_STAKE`'s `0` — so `isTakeable` stays fully ungated out of the box
// and the general roster is unaffected. The gated `Demo*` behaviour only kicks in when the
// always-on VM sets `TAKER_ALLOW_PREFIX=Demo` explicitly. Scenarios below pass `TAKER_ALLOW_PREFIX:
// ''` explicitly anyway, just to make each test's intent self-evident without relying on the
// module default.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthResponse, LedgerEntry, OpenChallenge } from '@rapidclash/shared';
import type { Api } from './http.js';
import type { BotConfig } from './config.js';

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

  it('never claims a HUMAN_RESERVED_STAKES (2) challenge, gated or not', async () => {
    const { isTakeable } = await loadBot({ TAKER_ALLOW_PREFIX: '' });
    // Issue #381: 2 is reserved — a human's tap-again gesture on the 1¢ preset
    // (apps/web/src/screens/GameHub.tsx) must never get sniped by a taker bot.
    expect(isTakeable(challenge({ ownerName: 'AnyHuman', stake: 2 }))).toBe(false);
  });

  it('claims a stake-100 challenge — issue #384 un-reserved it now that 2 alone covers human-only testing', async () => {
    const { isTakeable } = await loadBot({ TAKER_ALLOW_PREFIX: '' });
    expect(isTakeable(challenge({ ownerName: 'AnyHuman', stake: 100 }))).toBe(true);
  });

  it('never claims any of the 5 new Chess high-stake tiers (250/500/1000/2500/5000/10000), gated or not — ticket 2026-09-12', async () => {
    const { isTakeable } = await loadBot({ TAKER_ALLOW_PREFIX: '' });
    // These tiers are only reachable via ChessHub's tap-again escalation on the "100" preset
    // (apps/web/src/screens/GameHub.tsx's `highStakeCycle`) — reserved the same way `2` already is,
    // so a taker bot never snipes a showcase high-stake Chess challenge from a human.
    for (const stake of [250, 500, 1000, 2500, 5000, 10000]) {
      expect(isTakeable(challenge({ ownerName: 'AnyHuman', stake }))).toBe(false);
    }
  });

  it('TAKER_EXCLUDE_STAKE defaults to 0 (no-op) — every non-reserved stake stays claimable', async () => {
    const { isTakeable } = await loadBot({ TAKER_EXCLUDE_STAKE: undefined, TAKER_ALLOW_PREFIX: '' });
    for (const stake of [1, 5, 10, 25, 50, 100]) {
      expect(isTakeable(challenge({ ownerName: 'AnyHuman', stake }))).toBe(true);
    }
  });
});

describe('isTakeable — TAKER_ALLOW_PREFIX default (issue #368)', () => {
  it("defaults to '' — any human is claimed with zero config (general roster unaffected)", async () => {
    const { isTakeable } = await loadBot({});
    expect(isTakeable(challenge({ ownerName: 'DemoAcmeCapital', stake: 25 }))).toBe(true);
    expect(isTakeable(challenge({ ownerName: 'AnyHuman', stake: 25 }))).toBe(true);
  });

  it('the match is case-sensitive when a prefix IS set — a lowercase "demo…" name does not qualify', async () => {
    const { isTakeable } = await loadBot({ TAKER_ALLOW_PREFIX: 'Demo' });
    expect(isTakeable(challenge({ ownerName: 'demoLowercase', stake: 25 }))).toBe(false);
    expect(isTakeable(challenge({ ownerName: 'DemoLowercase', stake: 25 }))).toBe(true);
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

  it('claims ANY stake a Demo*-prefixed account posts (not just a fixed 1) except the excluded one and HUMAN_RESERVED_STAKES', async () => {
    const { isTakeable } = await loadBot({
      TAKER_ALLOW_PREFIX: 'Demo',
      TAKER_EXCLUDE_STAKE: '10',
    });
    for (const stake of [1, 5, 25, 50, 100]) {
      expect(isTakeable(challenge({ ownerName: 'DemoInvestor1', stake }))).toBe(true);
    }
    expect(isTakeable(challenge({ ownerName: 'DemoInvestor1', stake: 10 }))).toBe(false); // excluded
    expect(isTakeable(challenge({ ownerName: 'DemoInvestor1', stake: 2 }))).toBe(false); // human-reserved (issue #381)
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

  it('scales correctly across the full non-reserved stake range', async () => {
    const { hasSufficientFunds } = await loadBot({});
    for (const stake of [1, 5, 10, 25, 50, 100]) {
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

// Issue #532: bot-crowd's top-up idempotency key used to be `${playerId}:${topUpSeq++}`, an
// in-memory counter that resets to 0 on every process restart. Since bot-crowd restarts after
// every deploy (standing runbook), a bot that previously needed a top-up would reuse the same
// low-numbered key from its prior life; the ledger's idempotency correctly treated that as a
// duplicate and returned the stale original entry with 200 OK, but the client added that stale
// amount to its own local balance regardless — silently desyncing the bot's tracked balance from
// the real server-side balance until it got permanently stuck. The fix: a `randomUUID()` per
// attempt, genuinely unique across restarts (no in-memory counter to reset).
//
// `ensureFunds` (and the `playerId`/`balance` state it reads/writes) are private Bot members —
// there's no live server/WS in a unit test to drive them through `start()`, so these tests reach
// past the `private` (compile-time only) modifier to drive `ensureFunds` directly, exactly as
// `move-policy.test.ts` already reaches into `Bot.matchState` via a cast for the same reason.
describe('Bot#ensureFunds — top-up idempotency key (issue #532)', () => {
  function fakeApi(adminCredit: Api['adminCredit']): Api {
    return {
      register: vi.fn(async (): Promise<AuthResponse> => {
        throw new Error('not used by these tests');
      }),
      login: vi.fn(async (): Promise<AuthResponse> => {
        throw new Error('not used by these tests');
      }),
      wallet: vi.fn(async () => {
        throw new Error('not used by these tests');
      }),
      adminCredit,
    };
  }

  const cfg: BotConfig = { name: '🤖tester', gameId: 'rps', stake: 5, policy: 'rester' };

  /** Bare-minimum handle onto a Bot's private funding internals, for direct unit testing. */
  type BotInternals = {
    playerId: string;
    balance: number;
    ensureFunds(stake?: number): Promise<void>;
  };

  async function makeBot(adminCredit: Api['adminCredit'], playerId = 'player-1') {
    const { Bot } = await loadBot({ ADMIN_PASSWORD: 'irrelevant-here' });
    const bot = new Bot(cfg, fakeApi(adminCredit), () => 'fake-admin-token') as unknown as BotInternals;
    bot.playerId = playerId;
    bot.balance = 0; // well under cfg.stake × the default factor — always triggers a top-up
    return bot;
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  it('sends an idempotency key of the form botcrowd:topup:<playerId>:<uuid>', async () => {
    const adminCredit = vi.fn(async (_playerId, body): Promise<LedgerEntry> => ({
      id: 'e1',
      type: 'ADMIN_CREDIT',
      amount: 500,
      idempotencyKey: body.idempotencyKey,
      createdAt: new Date().toISOString(),
    }));
    const bot = await makeBot(adminCredit, 'player-1');
    await bot.ensureFunds();

    expect(adminCredit).toHaveBeenCalledTimes(1);
    const [playerId, body] = adminCredit.mock.calls[0]!;
    expect(playerId).toBe('player-1');
    const [prefix, kind, keyPlayerId, uuid] = body.idempotencyKey.split(':');
    expect(prefix).toBe('botcrowd');
    expect(kind).toBe('topup');
    expect(keyPlayerId).toBe('player-1');
    expect(uuid).toMatch(UUID_RE);
  });

  it('two top-ups in the SAME process both use distinct keys and both actually credit the local balance', async () => {
    const adminCredit = vi.fn(async (_playerId, body): Promise<LedgerEntry> => ({
      id: `e-${body.idempotencyKey}`,
      type: 'ADMIN_CREDIT',
      amount: 500,
      idempotencyKey: body.idempotencyKey,
      createdAt: new Date().toISOString(),
    }));
    const bot = await makeBot(adminCredit);

    await bot.ensureFunds(1000); // balance 0 < 1000×factor — tops up
    expect(bot.balance).toBe(500);
    bot.balance = 0; // simulate balance dropping low again within the same process
    await bot.ensureFunds(1000);
    expect(bot.balance).toBe(500); // credited again — not silently no-op'd

    expect(adminCredit).toHaveBeenCalledTimes(2);
    const key1 = adminCredit.mock.calls[0]![1].idempotencyKey;
    const key2 = adminCredit.mock.calls[1]![1].idempotencyKey;
    expect(key1).not.toBe(key2); // the old topUpSeq-based key could collide across restarts; this can't
  });

  it('two SEPARATE Bot instances (simulating two process lifetimes across a restart) never produce the same first-attempt key', async () => {
    // This is the exact bug scenario: with the old `topUpSeq` counter, EVERY freshly-constructed
    // Bot's first top-up used seq 0, so two "lives" of the same bot account collided on key
    // `botcrowd:topup:<playerId>:0`. A random UUID has no such fixed starting point.
    const adminCredit = vi.fn(async (_playerId, body): Promise<LedgerEntry> => ({
      id: `e-${body.idempotencyKey}`,
      type: 'ADMIN_CREDIT',
      amount: 500,
      idempotencyKey: body.idempotencyKey,
      createdAt: new Date().toISOString(),
    }));
    const restart1 = await makeBot(adminCredit, 'same-player-across-restarts');
    const restart2 = await makeBot(adminCredit, 'same-player-across-restarts');

    await restart1.ensureFunds();
    await restart2.ensureFunds();

    const key1 = adminCredit.mock.calls[0]![1].idempotencyKey;
    const key2 = adminCredit.mock.calls[1]![1].idempotencyKey;
    expect(key1).not.toBe(key2);
    expect(restart1.balance).toBe(500);
    expect(restart2.balance).toBe(500); // both restarts actually got credited — the bug's symptom is gone
  });

  it('documents WHY the fix has to be the key, not the response handling: a reused key (forced here) still desyncs the local tracker', async () => {
    // Not a regression test for the ledger (out of scope — packages/core/src/ledger.ts is
    // untouched, and its dedupe-by-key + 200 OK behaviour is correct by design). This forces the
    // exact pre-fix scenario — two calls sharing one idempotency key, as `topUpSeq` reset would
    // have produced — to show bot-crowd's response handling has no way to tell a fresh credit from
    // a deduped replay. That's why #532's fix is "never reuse a key" (proven above), not a change
    // to how `ensureFunds` consumes the response.
    const staleEntry: LedgerEntry = {
      id: 'e1',
      type: 'ADMIN_CREDIT',
      amount: 500,
      idempotencyKey: 'botcrowd:topup:dup-player:fixed-key', // deliberately reused below
      createdAt: new Date().toISOString(),
    };
    // A ledger that dedupes by key returns the SAME original entry for every call reusing it.
    const adminCredit = vi.fn(async (): Promise<LedgerEntry> => staleEntry);
    const bot = await makeBot(adminCredit, 'dup-player');

    await bot.ensureFunds(1000);
    bot.balance = 0; // balance drops again, but the server-side balance never actually moved
    await bot.ensureFunds(1000);

    expect(adminCredit).toHaveBeenCalledTimes(2);
    // Both calls reused the same key (forced), yet the local tracker credited twice — this IS
    // #532's desync bug, reproduced deliberately to show it's about key uniqueness, not this code.
    expect(bot.balance).toBe(500);
  });
});
