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

describe('ROSTER — gated mode (TAKER_ONLY_GAMES set, issue #361)', () => {
  it('adds a resting pool at GATED_RESTER_STAKES alongside the existing taker, per curated game', async () => {
    const { ROSTER, GATED_RESTER_STAKES, BOT_PREFIX } = await loadConfig({
      TAKER_ONLY_GAMES: 'coinflip,chess',
    });

    expect(ROSTER).toHaveLength(2 * (1 + GATED_RESTER_STAKES.length));

    const allNames = new Set<string>();
    for (const g of ['coinflip', 'chess']) {
      const gameBots = ROSTER.filter((b) => b.gameId === g);
      const takers = gameBots.filter((b) => b.policy === 'taker');
      const resters = gameBots.filter((b) => b.policy === 'rester');

      expect(takers).toHaveLength(1);
      // Names are no longer game/stake-encoded (issue #375) — just BOT_PREFIX + '@' + a Pool 2 handle.
      expect(takers[0].name).toMatch(new RegExp(`^${BOT_PREFIX}@[a-z]+$`));

      expect(resters).toHaveLength(GATED_RESTER_STAKES.length);
      const resterStakes = resters.map((b) => b.stake).sort((a, b) => a - b);
      expect(resterStakes).toEqual([...GATED_RESTER_STAKES].sort((a, b) => a - b));
      expect(new Set(resters.map((b) => b.stake)).size).toBe(GATED_RESTER_STAKES.length); // distinct stakes
      for (const b of resters) expect(b.name).toMatch(new RegExp(`^${BOT_PREFIX}@[a-z]+$`));

      for (const b of gameBots) allNames.add(b.name);
    }
    // Every identity in this scenario got a distinct name (positional assignment, no collisions).
    const totalBots = ROSTER.length;
    expect(allNames.size).toBe(totalBots);
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

describe('HUMAN_RESERVED_STAKES (issue #381: generalized from the single HUMAN_RESERVED_STAKE=100)', () => {
  it('is exactly [2, 100] — 2 (issue #381, apps/web tap-again gesture) alongside the original 100', async () => {
    const { HUMAN_RESERVED_STAKES } = await loadConfig({});
    expect([...HUMAN_RESERVED_STAKES]).toEqual([2, 100]);
  });

  it("the general (non-gated) roster's rester stake pool never includes a HUMAN_RESERVED_STAKES value — 2 is excluded exactly like 100 already was", async () => {
    const { ROSTER, HUMAN_RESERVED_STAKES } = await loadConfig({ TAKER_ONLY_GAMES: undefined });
    const resterStakes = ROSTER.filter((b) => b.policy === 'rester').map((b) => b.stake);
    expect(resterStakes.length).toBeGreaterThan(0);
    for (const stake of resterStakes) expect(HUMAN_RESERVED_STAKES.includes(stake)).toBe(false);
  });
});

describe('GATED_RESTER_STAKES (issue #375: 3 lanes, 2 randomized once at startup)', () => {
  it('is a small, distinct, modest stake set below the top HUMAN_RESERVED_STAKES tier (100) — and never lands on the OTHER reserved tier (2) either (issue #381)', async () => {
    const { GATED_RESTER_STAKES, HUMAN_RESERVED_STAKES } = await loadConfig({});
    expect(GATED_RESTER_STAKES.length).toBe(3);
    expect(new Set(GATED_RESTER_STAKES).size).toBe(GATED_RESTER_STAKES.length); // all distinct
    for (const stake of GATED_RESTER_STAKES) {
      expect(stake).toBeGreaterThan(0);
      expect(stake).toBeLessThan(100);
      expect(HUMAN_RESERVED_STAKES.includes(stake)).toBe(false);
    }
  });

  it('Lane A is 1 or 10, Lane B is 5 or 50, Lane C is fixed 25 — every value a real BET_PRESETS entry', async () => {
    const { GATED_RESTER_STAKES } = await loadConfig({});
    const [laneA, laneB, laneC] = GATED_RESTER_STAKES;
    expect([1, 10]).toContain(laneA);
    expect([5, 50]).toContain(laneB);
    expect(laneC).toBe(25);
  });

  it('the three lanes are mutually distinct by construction, regardless of which random branch each lands on', async () => {
    // {1,10} / {5,50} / {25} are disjoint sets, so distinctness holds no matter which of the 4
    // (laneA × laneB) random combinations gets drawn — load repeatedly to exercise more than one.
    for (let i = 0; i < 10; i++) {
      const { GATED_RESTER_STAKES } = await loadConfig({});
      expect(new Set(GATED_RESTER_STAKES).size).toBe(3);
    }
  });

  it('is re-drawn fresh per module load (randomized at startup, not a fixed literal anymore)', async () => {
    // Not a hard assertion on any one run (it's random), but sampling several loads should not
    // always produce the exact same tuple — guards against someone "fixing" the randomization
    // back to a static literal without updating this test.
    const draws = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const { GATED_RESTER_STAKES } = await loadConfig({});
      draws.add(GATED_RESTER_STAKES.join(','));
    }
    expect(draws.size).toBeGreaterThan(1);
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

  // NOTE (issue #375): there used to be a test here asserting the recommended
  // TAKER_EXCLUDE_STAKE=10 is always distinct from GATED_RESTER_STAKES. That invariant no longer
  // holds structurally: GATED_RESTER_STAKES's 3 lanes are now randomized once at startup (Lane A:
  // 1 or 10; Lane B: 5 or 50; Lane C: fixed 25), and together the lanes' possible values span
  // every non-reserved BET_PRESETS entry (1, 5, 10, 25, 50) — so there is no single fixed
  // TAKER_EXCLUDE_STAKE left that can be *guaranteed* distinct from whatever GATED_RESTER_STAKES
  // draws at boot. `config.ts`'s `takerExcludeStake` doc comment spells this out; it's now a
  // best-effort operator choice, not a config-time-checkable invariant, so it isn't asserted here.
});
