// Tests for the gated-mode multi-stake resting pool (issue #361). config.ts computes ROSTER
// (and the other TAKER_ONLY_GAMES-derived consts) eagerly at module load from process.env, so
// each scenario resets the module registry and re-imports with its own env — the same pattern
// as testing any other env-driven singleton config module.
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

async function loadConfig(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import('./config.js');
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('ROSTER — general (non-gated) mode is unaffected', () => {
  it('builds the full 26-bot roster when TAKER_ONLY_GAMES is unset (regression guard)', async () => {
    const { ROSTER, BOT_PREFIX } = await loadConfig({ TAKER_ONLY_GAMES: undefined });
    expect(ROSTER).toHaveLength(26);
    expect(ROSTER.every((b) => b.name.startsWith(BOT_PREFIX))).toBe(true);
    // The gated-mode '-rest-<stake>' naming convention must never leak into the general roster.
    expect(ROSTER.some((b) => b.name.includes('-rest-'))).toBe(false);
  });

  it('builds the full 26-bot roster when TAKER_ONLY_GAMES is empty (regression guard)', async () => {
    const { ROSTER } = await loadConfig({ TAKER_ONLY_GAMES: '' });
    expect(ROSTER).toHaveLength(26);
  });
});

describe('ROSTER — gated mode (TAKER_ONLY_GAMES set, issue #361; weighted resters, issue #393)', () => {
  it('adds a per-game weighted resting pool alongside the existing taker (bare gameIds default to weight 1)', async () => {
    const { ROSTER, BOT_PREFIX } = await loadConfig({
      TAKER_ONLY_GAMES: 'coinflip,chess',
    });

    // Bare gameIds (no ':N' suffix) default to weight 1 — 1 taker + 1 rester per game.
    expect(ROSTER).toHaveLength(2 * (1 + 1));

    const allNames = new Set<string>();
    for (const g of ['coinflip', 'chess']) {
      const gameBots = ROSTER.filter((b) => b.gameId === g);
      const takers = gameBots.filter((b) => b.policy === 'taker');
      const resters = gameBots.filter((b) => b.policy === 'rester');

      expect(takers).toHaveLength(1);
      // Names are no longer game/stake-encoded (issue #375) — just BOT_PREFIX + '@' + a Pool 2 handle.
      expect(takers[0].name).toMatch(new RegExp(`^${BOT_PREFIX}@[a-z]+$`));

      expect(resters).toHaveLength(1);
      for (const b of resters) {
        expect(b.name).toMatch(new RegExp(`^${BOT_PREFIX}@[a-z]+$`));
        expect(b.stake).toBeGreaterThan(0);
      }

      for (const b of gameBots) allNames.add(b.name);
    }
    // Every identity in this scenario got a distinct name (positional assignment, no collisions).
    const totalBots = ROSTER.length;
    expect(allNames.size).toBe(totalBots);
  });

  it('a weight suffix (gameId:N) produces N resters for that game', async () => {
    const { ROSTER } = await loadConfig({ TAKER_ONLY_GAMES: 'coinflip:3,blackjack' });

    const coinflipBots = ROSTER.filter((b) => b.gameId === 'coinflip');
    expect(coinflipBots.filter((b) => b.policy === 'taker')).toHaveLength(1);
    expect(coinflipBots.filter((b) => b.policy === 'rester')).toHaveLength(3);

    const blackjackBots = ROSTER.filter((b) => b.gameId === 'blackjack');
    expect(blackjackBots.filter((b) => b.policy === 'taker')).toHaveLength(1);
    expect(blackjackBots.filter((b) => b.policy === 'rester')).toHaveLength(1); // bare id → weight 1

    expect(ROSTER).toHaveLength((1 + 3) + (1 + 1));
  });

  it('a single game\'s own resters are ALWAYS mutually distinct when weight is within the stake pool size (real bug fix, found 2026-08-22)', async () => {
    // Regression test for a real production bug: independent randStake() draws per rester could
    // (and did — confirmed live on the gated VM: two RPS resters both drew 50 and matched EACH
    // OTHER on repeat for 80+ minutes) collide, silently causing bot-vs-bot play — a Charter
    // invariant #1 violation — because Matchmaking.joinQueue has no bot-vs-bot check (only the
    // TAKE path's isTakeable() does; the core has no concept of "bot" by design, ADR-010). Sample
    // repeatedly since it's randomized; every single draw must be fully distinct, not just usually.
    for (let i = 0; i < 20; i++) {
      const { ROSTER } = await loadConfig({ TAKER_ONLY_GAMES: 'coinflip:3' });
      const stakes = ROSTER.filter((b) => b.policy === 'rester').map((b) => b.stake);
      expect(stakes).toHaveLength(3);
      expect(new Set(stakes).size).toBe(3);
    }
  });

  it('multiple games each get their own independent distinct-stake draw (no cross-game interference)', async () => {
    const { ROSTER } = await loadConfig({ TAKER_ONLY_GAMES: 'coinflip:3,blackjack:3' });
    for (const g of ['coinflip', 'blackjack']) {
      const stakes = ROSTER.filter((b) => b.gameId === g && b.policy === 'rester').map((b) => b.stake);
      expect(new Set(stakes).size).toBe(stakes.length);
    }
  });

  it('once weight exceeds the stake pool size, repeats are unavoidable but never crash — no invented out-of-preset values', async () => {
    // RESTER_STAKES is 6 values (STAKE_SET minus HUMAN_RESERVED_STAKES — [2] isn't even in
    // STAKE_SET, so nothing is actually filtered out today: [1,5,10,25,50,100]). weight:8 exceeds
    // that, so a repeat is GUARANTEED (not just likely) once the pool cycles.
    const { ROSTER, STAKE_SET } = await loadConfig({ TAKER_ONLY_GAMES: 'coinflip:8' });
    const resters = ROSTER.filter((b) => b.policy === 'rester');
    expect(resters).toHaveLength(8);
    for (const b of resters) expect(STAKE_SET).toContain(b.stake); // always a real preset value
    const stakes = resters.map((b) => b.stake);
    expect(new Set(stakes).size).toBeLessThan(stakes.length); // a repeat is guaranteed past the pool size
  });

  it('keeps chess entries (taker + every rester) on the rapid10 control; leaves other games untimed', async () => {
    const { ROSTER } = await loadConfig({ TAKER_ONLY_GAMES: 'coinflip,chess' });
    for (const b of ROSTER.filter((x) => x.gameId === 'chess')) expect(b.timeControlId).toBe('rapid10');
    for (const b of ROSTER.filter((x) => x.gameId === 'coinflip')) expect(b.timeControlId).toBeUndefined();
  });

  it('every gated rester name is BOT_PREFIX-prefixed (ADR-010 honesty label)', async () => {
    const { ROSTER, BOT_PREFIX } = await loadConfig({ TAKER_ONLY_GAMES: 'blackjack' });
    for (const b of ROSTER.filter((x) => x.policy === 'rester')) expect(b.name.startsWith(BOT_PREFIX)).toBe(true);
  });

  it('gated resters are not prefix-gated — TAKER_ALLOW_PREFIX only scopes the taker path (issue #368)', async () => {
    // Prefix gating lives entirely in bot.ts's tryTake(), which only runs for policy 'taker'
    // (see `if (this.cfg.policy !== 'taker' || this.state !== 'idle') return;`). BotConfig itself
    // has no allow-prefix field, so a rester entry has no way to carry gating even if
    // TAKER_ALLOW_PREFIX is set — this is the acceptance criterion ("resters are NOT gated") holding
    // by construction, asserted here so a future refactor can't silently add gating to resters.
    const { ROSTER, config } = await loadConfig({
      TAKER_ONLY_GAMES: 'coinflip',
      TAKER_ALLOW_PREFIX: 'Demo',
    });
    const resters = ROSTER.filter((b) => b.policy === 'rester');
    expect(resters.length).toBeGreaterThan(0);
    expect(config.takerAllowPrefix).toBe('Demo');
    for (const b of resters) expect(Object.prototype.hasOwnProperty.call(b, 'allowPrefix')).toBe(false);
  });
});

describe('bot name pools stay disjoint across rosters (issue #375)', () => {
  it('the general roster (Pool 1) has 26 distinct names', async () => {
    const { ROSTER } = await loadConfig({ TAKER_ONLY_GAMES: undefined });
    expect(new Set(ROSTER.map((b) => b.name)).size).toBe(26);
  });

  it('no gated-roster name collides with a general-roster name, for the real deployment config (coinflip,blackjack,chess)', async () => {
    const { ROSTER: generalRoster } = await loadConfig({ TAKER_ONLY_GAMES: undefined });
    const { ROSTER: gatedRoster } = await loadConfig({ TAKER_ONLY_GAMES: 'coinflip,blackjack,chess' });
    const generalNames = new Set(generalRoster.map((b) => b.name));
    for (const b of gatedRoster) expect(generalNames.has(b.name)).toBe(false);
  });

  it('every ROSTER name (both branches) is exactly BOT_PREFIX + "@" + a lowercase handle', async () => {
    const { ROSTER: generalRoster, BOT_PREFIX } = await loadConfig({ TAKER_ONLY_GAMES: undefined });
    const { ROSTER: gatedRoster } = await loadConfig({ TAKER_ONLY_GAMES: 'coinflip,blackjack,chess' });
    const shape = new RegExp(`^${BOT_PREFIX}@[a-z]+$`);
    for (const b of [...generalRoster, ...gatedRoster]) expect(b.name).toMatch(shape);
  });
});

describe('HUMAN_RESERVED_STAKES (issue #381: generalized from the single HUMAN_RESERVED_STAKE=100; issue #384: 100 released back to bots)', () => {
  it('is exactly [2] — 100 was released back to bots by issue #384 now that 2 alone covers human-only testing', async () => {
    const { HUMAN_RESERVED_STAKES } = await loadConfig({});
    expect([...HUMAN_RESERVED_STAKES]).toEqual([2]);
  });

  it("the general (non-gated) roster's rester stake pool never includes a HUMAN_RESERVED_STAKES value (2), but CAN include 100 (issue #384)", async () => {
    const { ROSTER, HUMAN_RESERVED_STAKES } = await loadConfig({ TAKER_ONLY_GAMES: undefined });
    const resterStakes = ROSTER.filter((b) => b.policy === 'rester').map((b) => b.stake);
    expect(resterStakes.length).toBeGreaterThan(0);
    for (const stake of resterStakes) expect(HUMAN_RESERVED_STAKES.includes(stake)).toBe(false);
  });
});

describe('gated mode: weighted resters + the 34-name budget / overflow policy (issue #393)', () => {
  // GATED_ROSTER_NAMES is a 34-entry pool (not exported — its size is the spec'd budget itself,
  // see config.ts). Each game's block costs `1 (taker) + weight (resters)` names.

  it('a bare gameId (no ":N" suffix) defaults to weight 1 — matches today\'s old fixed minimum', async () => {
    const { ROSTER } = await loadConfig({ TAKER_ONLY_GAMES: 'blackjack' });
    expect(ROSTER.filter((b) => b.policy === 'taker')).toHaveLength(1);
    expect(ROSTER.filter((b) => b.policy === 'rester')).toHaveLength(1);
  });

  it('a malformed/non-numeric weight suffix falls back to weight 1, tolerantly (no throw)', async () => {
    const { ROSTER } = await loadConfig({ TAKER_ONLY_GAMES: 'blackjack:abc,chess:,coinflip:-3,rps:0' });
    for (const g of ['blackjack', 'chess', 'coinflip', 'rps']) {
      expect(ROSTER.filter((b) => b.gameId === g && b.policy === 'rester')).toHaveLength(1);
    }
  });

  it('weights summing exactly to the 34-name budget: every game gets its full block, nothing dropped', async () => {
    // Blocks (1 + weight): coinflip 8, blackjack 8, chess 8, rps 10 → 8+8+8+10 = 34, exact fit.
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { ROSTER } = await loadConfig({ TAKER_ONLY_GAMES: 'coinflip:7,blackjack:7,chess:7,rps:9' });

    for (const [g, weight] of [
      ['coinflip', 7],
      ['blackjack', 7],
      ['chess', 7],
      ['rps', 9],
    ] as const) {
      expect(ROSTER.filter((b) => b.gameId === g && b.policy === 'taker')).toHaveLength(1);
      expect(ROSTER.filter((b) => b.gameId === g && b.policy === 'rester')).toHaveLength(weight);
    }
    expect(ROSTER).toHaveLength(34);
    expect(new Set(ROSTER.map((b) => b.name)).size).toBe(34); // every identity got a distinct name

    // Fits exactly — no drop, so the informational log must NOT fire.
    const droppedLogs = logSpy.mock.calls.filter((args) => String(args[0]).includes('dropped'));
    expect(droppedLogs).toHaveLength(0);
    logSpy.mockRestore();
  });

  it('weights summing over budget: the trailing game is dropped atomically; earlier (kept) games are unaffected', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Same exact-fit 34 config as above, PLUS a 5th game appended — its block (1 + 1 = 2) cannot
    // fit in the 0 names left over, so 'mines' must be dropped entirely (never a taker-less rester
    // or rester-less taker for it).
    const noOverflowEnv = { TAKER_ONLY_GAMES: 'coinflip:7,blackjack:7,chess:7,rps:9' };
    const overflowEnv = { TAKER_ONLY_GAMES: 'coinflip:7,blackjack:7,chess:7,rps:9,mines' };

    const { ROSTER: baseline } = await loadConfig(noOverflowEnv);
    const { ROSTER: withOverflow } = await loadConfig(overflowEnv);

    // 'mines' never appears at all — no partial block.
    expect(withOverflow.some((b) => b.gameId === 'mines')).toBe(false);
    expect(withOverflow).toHaveLength(34);

    // The 4 kept games' identities (name, gameId, policy — everything except the randomized
    // `stake`) are byte-for-byte identical whether or not 'mines' was appended afterward.
    const strip = (roster: typeof baseline) =>
      roster.map((b) => ({ name: b.name, gameId: b.gameId, policy: b.policy }));
    expect(strip(withOverflow)).toEqual(strip(baseline));

    // Exactly one informational log, naming the dropped game and calling out the budget (not a bug).
    const droppedLogs = logSpy.mock.calls.filter((args) => String(args[0]).includes('dropped'));
    expect(droppedLogs).toHaveLength(1);
    expect(String(droppedLogs[0][0])).toContain('mines');
    expect(String(droppedLogs[0][0]).toLowerCase()).toContain('budget');
    expect(String(droppedLogs[0][0]).toLowerCase()).toContain('not a bug');
    logSpy.mockRestore();
  });

  it('overflow cascades: a later game that would fit the FULL budget on its own is still dropped once an earlier game already overflowed', async () => {
    // 'coinflip:40' alone needs a block of 41 > 34, so it overflows immediately (nothing used yet).
    // 'chess' (bare, block 2) would easily fit a fresh 34-name budget by itself, but per the atomic
    // list-order rule it must ALSO be dropped, because it comes after the first overflowing game.
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { ROSTER } = await loadConfig({ TAKER_ONLY_GAMES: 'coinflip:40,chess' });

    expect(ROSTER).toHaveLength(0); // both games dropped, no partial output

    const droppedLogs = logSpy.mock.calls.filter((args) => String(args[0]).includes('dropped'));
    expect(droppedLogs).toHaveLength(1);
    expect(String(droppedLogs[0][0])).toContain('coinflip');
    expect(String(droppedLogs[0][0])).toContain('chess');
    logSpy.mockRestore();
  });

  it('the drop-log fires only when something was actually dropped — a normal, well-within-budget boot logs nothing extra', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await loadConfig({ TAKER_ONLY_GAMES: 'coinflip,blackjack,chess' }); // 3 games × 2 = 6, nowhere near 34
    const droppedLogs = logSpy.mock.calls.filter((args) => String(args[0]).includes('dropped'));
    expect(droppedLogs).toHaveLength(0);
    logSpy.mockRestore();
  });

  it('gated resters never draw a HUMAN_RESERVED_STAKES value', async () => {
    const { ROSTER, HUMAN_RESERVED_STAKES } = await loadConfig({ TAKER_ONLY_GAMES: 'coinflip:3' });
    const resters = ROSTER.filter((b) => b.policy === 'rester');
    expect(resters.length).toBeGreaterThan(0);
    for (const b of resters) {
      expect(b.stake).toBeGreaterThan(0);
      expect(HUMAN_RESERVED_STAKES.includes(b.stake)).toBe(false);
    }
  });
});

describe('config.takerAllowPrefix (issue #368)', () => {
  it("defaults to '' (any human) — matches the other TAKER_* \"disabled\" sentinels, general roster unaffected", async () => {
    const { config } = await loadConfig({ TAKER_ALLOW_PREFIX: undefined });
    expect(config.takerAllowPrefix).toBe('');
  });

  it('reads TAKER_ALLOW_PREFIX from the environment, like the other TAKER_* config values', async () => {
    const { config } = await loadConfig({ TAKER_ALLOW_PREFIX: 'Investor' });
    expect(config.takerAllowPrefix).toBe('Investor');
  });

  it('an explicit empty string disables the gate entirely (matches the old "empty = any human" sentinel)', async () => {
    const { config } = await loadConfig({ TAKER_ALLOW_PREFIX: '' });
    expect(config.takerAllowPrefix).toBe('');
  });
});

describe('config.takerExcludeStake (issue #362)', () => {
  it('defaults to 0 — "no stake excluded", a no-op matching takerStake\'s own sentinel', async () => {
    const { config } = await loadConfig({ TAKER_EXCLUDE_STAKE: undefined });
    expect(config.takerExcludeStake).toBe(0);
  });

  it('reads TAKER_EXCLUDE_STAKE from the environment, like the other TAKER_* config values', async () => {
    const { config } = await loadConfig({ TAKER_EXCLUDE_STAKE: '10' });
    expect(config.takerExcludeStake).toBe(10);
  });

  it('falls back to 0 for a non-numeric override (same "ignore garbage" behaviour as num() elsewhere)', async () => {
    const { config } = await loadConfig({ TAKER_EXCLUDE_STAKE: 'not-a-number' });
    expect(config.takerExcludeStake).toBe(0);
  });

  // NOTE (issue #375, updated #384, #393): there used to be a test here asserting the recommended
  // TAKER_EXCLUDE_STAKE=10 is always distinct from the gated resters' stakes. That invariant
  // doesn't hold structurally: issue #393 replaced the old fixed-3-lane GATED_RESTER_STAKES with a
  // per-game, per-rester randStake() draw (same pool the general roster's own resters use —
  // STAKE_SET minus HUMAN_RESERVED_STAKES), so the possible values span every non-reserved
  // BET_PRESETS entry (1, 5, 10, 25, 50, 100) regardless of how many resters a game has — there is
  // no single fixed TAKER_EXCLUDE_STAKE left that can be *guaranteed* distinct from every gated
  // rester's actual draw at boot. `config.ts`'s `takerExcludeStake` doc comment spells this out;
  // it's a best-effort operator choice, not a config-time-checkable invariant, so it isn't
  // asserted here.
});
