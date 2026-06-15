// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CoinflipPlayScreen } from '../screens/CoinflipPlay.js';
import type { CoinflipView } from '../App.js';

// alice = caller (players[0]); bob = non-caller.
const callerProps = { playerId: 'alice', username: 'alice', opponentId: 'bob', onMove: vi.fn(), onForfeit: vi.fn() };
const nonCallerProps = { playerId: 'bob', username: 'bob', opponentId: 'alice', onMove: vi.fn(), onForfeit: vi.fn() };

function view(partial: Partial<CoinflipView>): CoinflipView {
  return { players: ['alice', 'bob'], caller: 'alice', ...partial };
}

describe('CoinflipPlayScreen', () => {
  it('shows the player their own alias as "You (<alias>)" (#34)', () => {
    render(
      <CoinflipPlayScreen {...callerProps} gameState={view({})} legalMoves={['heads', 'tails']} />,
    );
    expect(screen.getByTestId('play-you').textContent).toBe('You (alice)');
  });

  it('shows heads/tails to the caller and they are enabled on their turn', () => {
    render(
      <CoinflipPlayScreen
        {...callerProps}
        gameState={view({})}
        legalMoves={['heads', 'tails']}
      />,
    );
    expect(screen.getByTestId('move-heads')).not.toBeDisabled();
    expect(screen.getByTestId('move-tails')).not.toBeDisabled();
  });

  it('calls onMove with the chosen side', () => {
    const onMove = vi.fn();
    render(
      <CoinflipPlayScreen
        {...callerProps}
        onMove={onMove}
        gameState={view({})}
        legalMoves={['heads', 'tails']}
      />,
    );
    fireEvent.click(screen.getByTestId('move-heads'));
    expect(onMove).toHaveBeenCalledWith('heads');
  });

  it('disables the buttons after the call (legalMoves empty)', () => {
    render(
      <CoinflipPlayScreen
        {...callerProps}
        gameState={view({ call: 'heads' })}
        legalMoves={[]}
      />,
    );
    expect(screen.getByTestId('move-heads')).toBeDisabled();
    expect(screen.getByTestId('move-tails')).toBeDisabled();
  });

  it('shows a waiting state to the non-caller and no call buttons', () => {
    render(
      <CoinflipPlayScreen
        {...nonCallerProps}
        gameState={view({})}
        legalMoves={[]}
      />,
    );
    expect(screen.getByTestId('waiting')).toBeInTheDocument();
    expect(screen.queryByTestId('move-heads')).toBeNull();
    expect(screen.queryByTestId('move-tails')).toBeNull();
  });

  it('HIDES the flip result while result is absent (pre-terminal suspense)', () => {
    render(
      <CoinflipPlayScreen
        {...callerProps}
        gameState={view({ call: 'heads' })} // result not yet revealed
        legalMoves={[]}
      />,
    );
    const flip = screen.getByTestId('flip-result');
    expect(flip.textContent).toBe('?');
    expect(flip.textContent).not.toMatch(/heads|tails/i);
  });

  it('REVEALS the flip result only once result is present (terminal)', () => {
    render(
      <CoinflipPlayScreen
        {...callerProps}
        gameState={view({ call: 'heads', result: 'tails' })}
        legalMoves={[]}
      />,
    );
    expect(screen.getByTestId('flip-result').textContent).toBe('Tails');
  });

  it('shows the call once made — "You called" for the caller, "Opponent called" for the other', () => {
    const { unmount } = render(
      <CoinflipPlayScreen {...callerProps} gameState={view({ call: 'heads' })} legalMoves={[]} />,
    );
    expect(screen.getByTestId('call-status').textContent).toContain('You called');
    expect(screen.getByTestId('call-status').textContent).toContain('Heads');
    unmount();

    render(
      <CoinflipPlayScreen {...nonCallerProps} gameState={view({ call: 'heads' })} legalMoves={[]} />,
    );
    expect(screen.getByTestId('call-status').textContent).toContain('Opponent called');
  });
});
