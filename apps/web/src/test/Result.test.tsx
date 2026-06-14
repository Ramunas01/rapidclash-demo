// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResultScreen } from '../screens/Result.js';

describe('ResultScreen', () => {
  it('shows You Won and positive delta for a win', () => {
    render(
      <ResultScreen
        outcome={{ type: 'win', winner: 'alice' }}
        settlement={{ delta: 90, newBalance: 1090 }}
        playerId="alice"
        onPlayAgain={vi.fn()}
        onLeaderboard={vi.fn()}
      />,
    );
    expect(screen.getByTestId('outcome-text').textContent).toContain('Won');
    expect(screen.getByTestId('delta').textContent).toContain('+90');
  });

  it('shows You Lost and negative delta for a loss', () => {
    render(
      <ResultScreen
        outcome={{ type: 'win', winner: 'bob' }}
        settlement={{ delta: -100, newBalance: 900 }}
        playerId="alice"
        onPlayAgain={vi.fn()}
        onLeaderboard={vi.fn()}
      />,
    );
    expect(screen.getByTestId('outcome-text').textContent).toContain('Lost');
    expect(screen.getByTestId('delta').textContent).toContain('-100');
  });

  it('shows Draw and zero delta', () => {
    render(
      <ResultScreen
        outcome={{ type: 'draw' }}
        settlement={{ delta: 0, newBalance: 1000 }}
        onPlayAgain={vi.fn()}
        onLeaderboard={vi.fn()}
      />,
    );
    expect(screen.getByTestId('outcome-text').textContent).toContain('Draw');
    expect(screen.getByTestId('delta').textContent).toContain('0');
  });
});
