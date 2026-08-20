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

    for (const g of ['coinflip', 'chess']) {
      const gameBots = ROSTER.filter((b) => b.gameId === g);
      const takers = gameBots.filter((b) => b.policy === 'taker');
      const resters = gameBots.filter((b) => b.policy === 'rester');

      expect(takers).toHaveLength(1);
      expect(takers[0].name).toBe(`${BOT_PREFIX}${g}-taker`);

      expect(resters).toHaveLength(GATED_RESTER_STAKES.length);
      const resterStakes = resters.map((b) => b.stake).sort((a, b) => a - b);
      expect(resterStakes).toEqual([...GATED_RESTER_STAKES].sort((a, b) => a - b));
      expect(new Set(resters.map((b) => b.stake)).size).toBe(GATED_RESTER_STAKES.length); // distinct stakes
      for (const b of resters) expect(b.name).toBe(`${BOT_PREFIX}${g}-rest-${b.stake}`);
    }
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

  it('gated resters are not allowlist-gated — TAKER_ALLOW_NAMES only scopes the taker path', async () => {
    // Allowlist gating lives entirely in bot.ts's tryTake(), which only runs for policy 'taker'
    // (see `if (this.cfg.policy !== 'taker' || this.state !== 'idle') return;`). BotConfig itself
    // has no allowlist field, so a rester entry has no way to carry gating even if TAKER_ALLOW_NAMES
    // is set — this is the acceptance criterion ("resters are NOT allowlist-gated") holding by
    // construction, asserted here so a future refactor can't silently add gating to resters.
    const { ROSTER, config } = await loadConfig({
      TAKER_ONLY_GAMES: 'coinflip',
      TAKER_ALLOW_NAMES: 'Demo,Investor1',
    });
    const resters = ROSTER.filter((b) => b.policy === 'rester');
    expect(resters.length).toBeGreaterThan(0);
    expect(config.takerAllowNames).toEqual(['Demo', 'Investor1']);
    for (const b of resters) expect(Object.prototype.hasOwnProperty.call(b, 'allowNames')).toBe(false);
  });
});

describe('GATED_RESTER_STAKES', () => {
  it('is a small, distinct, modest stake set below HUMAN_RESERVED_STAKE (real ledger — kept low)', async () => {
    const { GATED_RESTER_STAKES, HUMAN_RESERVED_STAKE } = await loadConfig({});
    expect(GATED_RESTER_STAKES.length).toBeGreaterThanOrEqual(2);
    expect(new Set(GATED_RESTER_STAKES).size).toBe(GATED_RESTER_STAKES.length); // all distinct
    for (const stake of GATED_RESTER_STAKES) {
      expect(stake).toBeGreaterThan(0);
      expect(stake).toBeLessThan(HUMAN_RESERVED_STAKE);
    }
  });
});
