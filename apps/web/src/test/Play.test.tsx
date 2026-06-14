// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlayScreen } from '../screens/Play.js';
import type { RpsView } from '../App.js';

const baseProps = {
  playerId: 'alice',
  opponentId: 'bob',
  onMove: vi.fn(),
  onForfeit: vi.fn(),
};

describe('PlayScreen', () => {
  it('enables move buttons when legalMoves is non-empty', () => {
    render(
      <PlayScreen
        {...baseProps}
        gameState={{ players: ['alice', 'bob'], choices: {} } as RpsView}
        legalMoves={['rock', 'paper', 'scissors']}
      />,
    );
    const rockBtn = screen.getByTestId('move-rock');
    expect(rockBtn).not.toBeDisabled();
  });

  it('disables buttons after a move (legalMoves empty)', () => {
    render(
      <PlayScreen
        {...baseProps}
        gameState={{ players: ['alice', 'bob'], choices: { alice: 'rock' } } as RpsView}
        legalMoves={[]}
      />,
    );
    expect(screen.getByTestId('move-rock')).toBeDisabled();
    expect(screen.getByTestId('move-paper')).toBeDisabled();
    expect(screen.getByTestId('move-scissors')).toBeDisabled();
  });

  it('calls onMove with the chosen move when button clicked', () => {
    const onMove = vi.fn();
    render(
      <PlayScreen
        {...baseProps}
        onMove={onMove}
        gameState={{ players: ['alice', 'bob'], choices: {} } as RpsView}
        legalMoves={['rock', 'paper', 'scissors']}
      />,
    );
    fireEvent.click(screen.getByTestId('move-rock'));
    expect(onMove).toHaveBeenCalledWith('rock');
  });

  it('does NOT show opponent choice before terminal state', () => {
    // Non-terminal: alice has moved, bob has not
    render(
      <PlayScreen
        {...baseProps}
        gameState={{ players: ['alice', 'bob'], choices: { alice: 'rock' } } as RpsView}
        legalMoves={[]}
      />,
    );
    // Opponent choice slot must show the redaction emoji, not a real choice
    const opponentEl = screen.getByTestId('opponent-choice');
    expect(opponentEl.textContent).toBe('🤫');
  });

  it('shows opponent choice after terminal state', () => {
    // Terminal: both have moved
    render(
      <PlayScreen
        {...baseProps}
        gameState={{ players: ['alice', 'bob'], choices: { alice: 'rock', bob: 'scissors' } } as RpsView}
        legalMoves={[]}
      />,
    );
    const opponentEl = screen.getByTestId('opponent-choice');
    // scissors emoji ✌️
    expect(opponentEl.textContent).toContain('✌');
  });
});
