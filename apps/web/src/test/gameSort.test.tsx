// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { relatedGamesFor } from '../components/hub-shared/gameSort.js';

// Ticket 2026-09-15#12: Related Games section selection — a fixed 3-slot head (Crash, Blackjack,
// Dice) with an in-place Mines substitution when the current game is one of those 3, then the
// remaining games in GRID_ORDER. Tested directly against Designer's own worked examples (Mines,
// Dice, Chess screens) rather than through rendered UI.
describe('relatedGamesFor (ticket 2026-09-15#12)', () => {
  // The real live roster today (matches GameHub.tsx's own `games` prop shape) — 6 playable.
  const LIVE = new Set(['rps', 'coinflip', 'chess', 'blackjack', 'mines', 'dice']);

  it('Mines screen: Mines is not one of the fixed 3, so the head stays Crash/Blackjack/Dice unchanged', () => {
    const ids = relatedGamesFor('mines', LIVE).map((g) => g.id);
    expect(ids).toEqual(['crash', 'blackjack', 'dice', 'coinflip', 'chess', 'rps', 'roulette', 'hilo', 'keno', 'baccarat', 'limbo']);
    expect(ids).not.toContain('mines'); // never shows the current game
  });

  it('Dice screen: Dice IS one of the fixed 3, substituted in place by Mines (not appended)', () => {
    const ids = relatedGamesFor('dice', LIVE).map((g) => g.id);
    expect(ids).toEqual(['crash', 'blackjack', 'mines', 'coinflip', 'chess', 'rps', 'roulette', 'hilo', 'keno', 'baccarat', 'limbo']);
    expect(ids).not.toContain('dice');
    // Mines takes Dice's exact head-slot position (index 2), not appended at the end.
    expect(ids.indexOf('mines')).toBe(2);
  });

  it('Chess screen: Chess is not one of the fixed 3, head unchanged, Chess simply excluded from the tail', () => {
    const ids = relatedGamesFor('chess', LIVE).map((g) => g.id);
    expect(ids).toEqual(['crash', 'blackjack', 'dice', 'coinflip', 'mines', 'rps', 'roulette', 'hilo', 'keno', 'baccarat', 'limbo']);
    expect(ids).not.toContain('chess');
  });

  it('every one of the other 11 games appears exactly once, regardless of which screen', () => {
    for (const current of ['mines', 'dice', 'chess', 'crash', 'blackjack', 'rps']) {
      const ids = relatedGamesFor(current, LIVE).map((g) => g.id);
      expect(ids).toHaveLength(11);
      expect(new Set(ids).size).toBe(11); // no duplicates
      expect(ids).not.toContain(current);
    }
  });

  it('the fixed head slots carry the real playable flag, not an assumption that they\'re always live', () => {
    // Crash is a real, confirmed non-playable game today (excluded from RANDOM_PLAYABLE_GAME_IDS).
    const slots = relatedGamesFor('mines', LIVE);
    const crashSlot = slots.find((g) => g.id === 'crash')!;
    const blackjackSlot = slots.find((g) => g.id === 'blackjack')!;
    expect(crashSlot.playable).toBe(false);
    expect(blackjackSlot.playable).toBe(true);
  });

  it('a coming-soon game in the tail is correctly flagged non-playable', () => {
    const slots = relatedGamesFor('mines', LIVE);
    const rouletteSlot = slots.find((g) => g.id === 'roulette')!;
    expect(rouletteSlot.playable).toBe(false);
  });
});
