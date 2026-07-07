// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { FlatCoin, COIN_FLIP_DURATION_S } from '../components/coin/FlatCoin.js';
import { BOLT_PATH } from '../components/cards/CardBack.js';

describe('FlatCoin (flat vector coin — Designer #4)', () => {
  it('rests on the flat HEADS face: token colours, tone-on-tone bolt, no gradient/glow/raster/hex', () => {
    const { container } = render(<FlatCoin />);
    expect(screen.getByTestId('coin-face').getAttribute('data-face')).toBe('heads');
    // Face disc + offset edge band + bolt — all token-driven.
    expect(screen.getByTestId('coin-face-disc').getAttribute('fill')).toBe('var(--coin-heads-face)');
    expect(screen.getByTestId('coin-face-bolt').getAttribute('fill')).toBe('var(--coin-heads-mark)');
    expect(screen.getByTestId('coin-face-bolt').getAttribute('d')).toBe(BOLT_PATH); // reuses the shared mark
    // Vector only — an SVG, no raster; flat — no gradient / glow / shadow anywhere; tokens — no hex.
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toMatch(/gradient|box-?shadow/i);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it('flips by WIDTH geometry and swaps to the target face at the midpoint — no 3D rotateY', async () => {
    vi.useFakeTimers();
    try {
      const { rerender, container } = render(<FlatCoin face={null} />);
      expect(screen.getByTestId('coin-face').getAttribute('data-face')).toBe('heads');
      // Reveal → flip to tails. Before the midpoint it still shows heads (swap lands at scaleX ≈ 0).
      rerender(<FlatCoin face="tails" />);
      expect(screen.getByTestId('coin-face').getAttribute('data-face')).toBe('heads');
      expect(container.innerHTML).not.toMatch(/rotatey/i); // pure width geometry, never a 3D spin
      // Past the midpoint → face + bolt switch to the tails tokens.
      await act(async () => { await vi.advanceTimersByTimeAsync((COIN_FLIP_DURATION_S * 1000) / 2 + 50); });
      expect(screen.getByTestId('coin-face').getAttribute('data-face')).toBe('tails');
      expect(screen.getByTestId('coin-face-disc').getAttribute('fill')).toBe('var(--coin-tails-face)');
      expect(screen.getByTestId('coin-face-bolt').getAttribute('fill')).toBe('var(--coin-tails-mark)');
    } finally {
      vi.useRealTimers();
    }
  });
});
