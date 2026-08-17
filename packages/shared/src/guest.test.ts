// packages/shared/src/guest.test.ts
// Issue #350 (guest bot economy, part 1/5): the shared constant + stake-lane config this ticket
// adds. Deliberately plumbing-only — no bot-waiter/bot-taker consumer exists yet (that's #351+),
// so these tests cover exactly what's genuinely checkable now: the reserved stake's value/
// uniqueness, and the stake-lane shape's structural + type-level correctness.

import { describe, it, expect } from 'vitest';
import {
  GUEST_HUMAN_RESERVED_STAKE,
  GUEST_BOT_STAKE_LANES,
  GUEST_CURATED_GAMES,
  GUEST_COINFLIP_STAKE,
  GUEST_CHESS_STAKE,
  GUEST_BLACKJACK_STAKE,
  type GuestCuratedGameId,
} from './guest.js';

describe('GUEST_HUMAN_RESERVED_STAKE', () => {
  it('is 1 — the opposite end of the range from tools/bot-crowd/src/config.ts HUMAN_RESERVED_STAKE (100)', () => {
    expect(GUEST_HUMAN_RESERVED_STAKE).toBe(1);
  });

  it('is never claimed by any existing fixed-stake guest bot constant', () => {
    expect(GUEST_COINFLIP_STAKE).not.toBe(GUEST_HUMAN_RESERVED_STAKE);
    expect(GUEST_CHESS_STAKE).not.toBe(GUEST_HUMAN_RESERVED_STAKE);
    expect(GUEST_BLACKJACK_STAKE).not.toBe(GUEST_HUMAN_RESERVED_STAKE);
  });

  it('does not collide with tools/bot-crowd HUMAN_RESERVED_STAKE (different isolated worlds, but the two values must not accidentally be equal)', () => {
    // Intentionally not importing tools/bot-crowd here (guest.ts must never depend on it — that's
    // the whole point of keeping the two worlds separate). This just documents the expectation
    // inline: bot-crowd's reserved stake is 100, this one is 1.
    expect(GUEST_HUMAN_RESERVED_STAKE).toBe(1);
    expect(GUEST_HUMAN_RESERVED_STAKE).not.toBe(100);
  });
});

describe('GUEST_BOT_STAKE_LANES', () => {
  it('is keyed by exactly the same games as GUEST_CURATED_GAMES — no drift between the two lists', () => {
    const laneKeys = Object.keys(GUEST_BOT_STAKE_LANES).sort();
    const curated = [...GUEST_CURATED_GAMES].sort();
    expect(laneKeys).toEqual(curated);
  });

  it('accepts a GuestCuratedGameId key at the type level for every curated game (compile-time check)', () => {
    // If this ever fails to typecheck, GuestCuratedGameId has drifted from GUEST_CURATED_GAMES's
    // actual runtime members — the point of this test is the `tsc -b` pass, not the assertion.
    const ids: GuestCuratedGameId[] = ['coinflip', 'chess', 'blackjack'];
    for (const id of ids) {
      expect(GUEST_BOT_STAKE_LANES[id]).toBeDefined();
    }
  });

  it.each(Object.entries(GUEST_BOT_STAKE_LANES))('%s: 3-4 distinct stakes, all under 100, none the reserved stake', (_game, stakes) => {
    expect(stakes.length).toBeGreaterThanOrEqual(3);
    expect(stakes.length).toBeLessThanOrEqual(4);
    expect(new Set(stakes).size).toBe(stakes.length); // no duplicate stakes within one game's lanes
    for (const stake of stakes) {
      expect(Number.isInteger(stake)).toBe(true);
      expect(stake).toBeGreaterThan(0);
      expect(stake).toBeLessThan(100);
      expect(stake).not.toBe(GUEST_HUMAN_RESERVED_STAKE);
    }
  });

  it('every game has its own lane array instance (no accidental shared-reference mutation risk)', () => {
    const games = Object.keys(GUEST_BOT_STAKE_LANES) as GuestCuratedGameId[];
    for (let i = 0; i < games.length; i++) {
      for (let j = i + 1; j < games.length; j++) {
        expect(GUEST_BOT_STAKE_LANES[games[i]]).not.toBe(GUEST_BOT_STAKE_LANES[games[j]]);
      }
    }
  });
});
