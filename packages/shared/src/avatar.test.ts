// packages/shared/src/avatar.test.ts
// Ticket 2026-09-25#6 (ADVISOR_TO_PM.md): this module's whole reason to exist is that client and
// server must compute the IDENTICAL name→avatar hash and the IDENTICAL bot-disclosure strip — a
// simulated opponent's avatar has to settle on the SAME face once matched, not jump to a different
// one. These tests lock down exact values against the prototype's own `avForName`/`avId` formula
// (`Full Spec.html:3129-3136`, read directly, not approximated), not just "some deterministic hash".

import { describe, it, expect } from 'vitest';
import { avForNameHash, avatarIdForName, stripBotDisclosure } from './avatar.js';
import { AVATAR_IDS } from './protocol.js';

describe('avForNameHash', () => {
  it('matches the prototype\'s own literal formula (h = (h*31 + charCode) | 0) exactly, for known inputs', () => {
    // Hand-computed reference values for short strings, independent of this module's own
    // implementation — a genuine cross-check, not a tautology.
    // 'a' -> h = (0*31 + 97) | 0 = 97
    expect(avForNameHash('a')).toBe(97);
    // 'ab' -> h1 = 97; h2 = (97*31 + 98) | 0 = 3007 + 98 = 3105
    expect(avForNameHash('ab')).toBe(3105);
    // '' -> loop never runs, h stays 0
    expect(avForNameHash('')).toBe(0);
  });

  it('is deterministic — the same name always hashes to the same value', () => {
    expect(avForNameHash('skyhook')).toBe(avForNameHash('skyhook'));
  });

  it('stays within signed 32-bit int range even for long inputs (the |0 truncation actually applies)', () => {
    const long = 'a'.repeat(500);
    const h = avForNameHash(long);
    expect(h).toBeGreaterThanOrEqual(-2147483648);
    expect(h).toBeLessThanOrEqual(2147483647);
  });
});

describe('avatarIdForName', () => {
  it('only ever returns a real preset id (rc-01..rc-24), never \'default\'', () => {
    for (const name of ['alice', 'bob', 'skyhook', 'a-very-long-username-1234567890', '']) {
      const id = avatarIdForName(name);
      expect(id).not.toBe('default');
      expect(AVATAR_IDS).toContain(id);
    }
  });

  it('is deterministic per name — repeated calls with the same name return the same preset', () => {
    expect(avatarIdForName('mrsteady')).toBe(avatarIdForName('mrsteady'));
  });

  it('matches the prototype\'s own avId formula directly: rc-((abs(hash) % 24) + 1), zero-padded', () => {
    const name = 'testname';
    const expectedIndex = Math.abs(avForNameHash(name)) % 24;
    const expectedId = `rc-${String(expectedIndex + 1).padStart(2, '0')}`;
    expect(avatarIdForName(name)).toBe(expectedId);
  });

  it('spreads across the full 24-preset pool, not just a handful (sanity check on the modulo)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(avatarIdForName(`user-${i}`));
    // Not asserting exactly 24 (birthday-paradox collisions are expected at n=500), but a healthy
    // spread rules out a degenerate hash that only ever hits one or two buckets.
    expect(seen.size).toBeGreaterThan(15);
  });
});

describe('stripBotDisclosure', () => {
  it('strips a leading 🤖 (with or without a following space)', () => {
    expect(stripBotDisclosure('🤖@skyhook')).toBe('skyhook');
    expect(stripBotDisclosure('🤖 @skyhook')).toBe('skyhook');
    expect(stripBotDisclosure('🤖skyhook')).toBe('skyhook');
  });

  it('strips a leading @ even with no 🤖 prefix at all', () => {
    expect(stripBotDisclosure('@rival')).toBe('rival');
  });

  it('leaves a bare name with neither prefix untouched', () => {
    expect(stripBotDisclosure('alice')).toBe('alice');
  });

  it('never strips an @ or 🤖 that appears mid-string, only a LEADING one', () => {
    expect(stripBotDisclosure('foo@bar')).toBe('foo@bar');
    expect(stripBotDisclosure('a🤖b')).toBe('a🤖b');
  });

  it('strips BOTH in the combined "🤖 @name" order the real bug report showed, in one pass', () => {
    expect(stripBotDisclosure('🤖 @skyhook')).toBe('skyhook');
  });
});
