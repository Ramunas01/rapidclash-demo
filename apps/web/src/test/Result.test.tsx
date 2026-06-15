// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import confetti from 'canvas-confetti';
import { ResultScreen } from '../screens/Result.js';

// canvas-confetti needs a real <canvas> (absent in jsdom) — mock it and assert calls.
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

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

  it('fires tasteful confetti on a win', () => {
    render(
      <ResultScreen
        outcome={{ type: 'win', winner: 'alice' }}
        settlement={{ delta: 90, newBalance: 1090 }}
        playerId="alice"
        onPlayAgain={vi.fn()}
        onLeaderboard={vi.fn()}
      />,
    );
    expect(confetti).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire confetti on a loss or draw', () => {
    render(
      <ResultScreen
        outcome={{ type: 'win', winner: 'bob' }}
        settlement={{ delta: -100, newBalance: 900 }}
        playerId="alice"
        onPlayAgain={vi.fn()}
        onLeaderboard={vi.fn()}
      />,
    );
    expect(confetti).not.toHaveBeenCalled();
  });
});
