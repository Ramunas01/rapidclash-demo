// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import confetti from 'canvas-confetti';
import { CoinflipPlayScreen } from '../screens/CoinflipPlay.js';
import type { CoinflipView } from '../App.js';

// canvas-confetti needs a real <canvas> (absent in jsdom) — mock it and assert calls.
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

const aliceProps = { playerId: 'alice', username: 'alice', opponentId: 'bob', onMove: vi.fn(), onForfeit: vi.fn() };
const bobProps = { playerId: 'bob', username: 'bob', opponentId: 'alice', onMove: vi.fn(), onForfeit: vi.fn() };

/** Build a (possibly redacted) CoinflipView — both-players-choose shape. */
function view(partial: Partial<CoinflipView>): CoinflipView {
  return { players: ['alice', 'bob'], choices: {}, ...partial };
}

describe('CoinflipPlayScreen (both-players-choose)', () => {
  it('shows the player their own alias as "You (<alias>)" (#34)', () => {
    render(<CoinflipPlayScreen {...aliceProps} gameState={view({})} legalMoves={['heads', 'tails']} />);
    expect(screen.getByTestId('play-you').textContent).toBe('You (alice)');
  });

  it('lets EITHER player choose heads/tails (no caller) — buttons enabled on their turn', () => {
    const { unmount } = render(
      <CoinflipPlayScreen {...aliceProps} gameState={view({})} legalMoves={['heads', 'tails']} />,
    );
    expect(screen.getByTestId('move-heads')).not.toBeDisabled();
    expect(screen.getByTestId('move-tails')).not.toBeDisabled();
    unmount();

    // The non-"first" player (bob) gets the exact same buttons — there is no caller role.
    render(<CoinflipPlayScreen {...bobProps} gameState={view({})} legalMoves={['heads', 'tails']} />);
    expect(screen.getByTestId('move-heads')).not.toBeDisabled();
    expect(screen.getByTestId('move-tails')).not.toBeDisabled();
  });

  it('calls onMove with the chosen side', () => {
    const onMove = vi.fn();
    render(<CoinflipPlayScreen {...aliceProps} onMove={onMove} gameState={view({})} legalMoves={['heads', 'tails']} />);
    fireEvent.click(screen.getByTestId('move-tails'));
    expect(onMove).toHaveBeenCalledWith('tails');
  });

  it('disables the buttons after this player has chosen (legalMoves empty), and shows a waiting state', () => {
    render(<CoinflipPlayScreen {...aliceProps} gameState={view({ choices: { alice: 'heads' } })} legalMoves={[]} />);
    expect(screen.getByTestId('move-heads')).toBeDisabled();
    expect(screen.getByTestId('move-tails')).toBeDisabled();
    expect(screen.getByTestId('waiting')).toBeInTheDocument();
  });

  it("HIDES the opponent's choice and the flip pre-terminal (chooser's view)", () => {
    // alice has chosen; bob has not → not terminal. The server-redacted view alice holds
    // has only her own choice and NO result.
    render(<CoinflipPlayScreen {...aliceProps} gameState={view({ choices: { alice: 'heads' } })} legalMoves={[]} />);
    expect(screen.getByTestId('flip-result').textContent).toBe('?');
    expect(screen.getByTestId('opponent-pick').textContent).toBe('🤫');
    expect(screen.getByTestId('my-pick').textContent).toBe('Heads'); // own choice visible
  });

  it("HIDES the opponent's choice and the flip pre-terminal (waiter's redacted view)", () => {
    // From bob's redacted view, alice's choice is stripped entirely (choices = {}), no result.
    render(<CoinflipPlayScreen {...bobProps} gameState={view({ choices: {} })} legalMoves={['heads', 'tails']} />);
    expect(screen.getByTestId('flip-result').textContent).toBe('?');
    expect(screen.getByTestId('opponent-pick').textContent).toBe('🤫');
  });

  it('reveals both choices, the flip, and a WIN at terminal', () => {
    // Both chose (different) + result present → terminal. alice=heads matches result=heads → alice wins.
    render(
      <CoinflipPlayScreen
        {...aliceProps}
        gameState={view({ choices: { alice: 'heads', bob: 'tails' }, result: 'heads' })}
        legalMoves={[]}
      />,
    );
    expect(screen.getByTestId('flip-result').textContent).toBe('Heads');
    expect(screen.getByTestId('my-pick').textContent).toBe('Heads');
    expect(screen.getByTestId('opponent-pick').textContent).toBe('Tails');
    expect(screen.getByTestId('cf-outcome').textContent).toContain('win');
    expect(confetti).toHaveBeenCalledTimes(1);
  });

  it('renders a LOSE at terminal (and no confetti)', () => {
    // Same match from bob's perspective: bob=tails, result=heads → bob loses.
    render(
      <CoinflipPlayScreen
        {...bobProps}
        gameState={view({ choices: { alice: 'heads', bob: 'tails' }, result: 'heads' })}
        legalMoves={[]}
      />,
    );
    expect(screen.getByTestId('cf-outcome').textContent).toContain('lose');
    expect(confetti).not.toHaveBeenCalled();
  });

  it('renders a DRAW when both chose the same side (no confetti)', () => {
    render(
      <CoinflipPlayScreen
        {...aliceProps}
        gameState={view({ choices: { alice: 'heads', bob: 'heads' }, result: 'tails' })}
        legalMoves={[]}
      />,
    );
    expect(screen.getByTestId('cf-outcome').textContent).toContain('Draw');
    expect(confetti).not.toHaveBeenCalled();
  });
});
