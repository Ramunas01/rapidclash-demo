// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MinesPlayScreen } from '../screens/MinesPlay.js';
import type { MinesView, MinesBoardView } from '../App.js';

const aliceProps = { playerId: 'alice', username: 'alice', opponentId: 'bob', onMove: vi.fn(), onForfeit: vi.fn() };

const allCovered = Array.from({ length: 64 }, (_, i) => i);

function view(me: Partial<MinesBoardView>, opp: Partial<MinesBoardView> = {}, extra: Partial<MinesView> = {}): MinesView {
  return {
    players: ['alice', 'bob'],
    round: 0,
    draws: 0,
    boards: {
      alice: { locked: false, ...me },
      bob: { locked: false, ...opp },
    },
    ...extra,
  };
}

const kind = (i: number) => screen.getByTestId(`cell-${i}`).getAttribute('data-kind');

describe('MinesPlayScreen', () => {
  it('renders the own 8×8 board (64 cells) and the player’s safe count', () => {
    render(<MinesPlayScreen {...aliceProps} gameState={view({ uncovered: [] })} legalMoves={allCovered} />);
    expect(screen.getByTestId('mines-board')).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')).toHaveLength(64);
    expect(screen.getByTestId('play-you').textContent).toContain('0 safe');
    expect(screen.getByTestId('my-status').textContent).toBe('Your move');
  });

  it('gates clicks to server legalMoves: only covered+legal cells fire onMove(index)', () => {
    const onMove = vi.fn();
    // Server says only square 5 is legal right now (the rest are non-legal for this render).
    render(<MinesPlayScreen {...aliceProps} onMove={onMove} gameState={view({ uncovered: [] })} legalMoves={[5]} />);

    expect(screen.getByTestId('cell-5')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('cell-5'));
    expect(onMove).toHaveBeenCalledWith(5);

    // A covered square NOT in legalMoves is disabled and never fires.
    onMove.mockClear();
    expect(screen.getByTestId('cell-6')).toBeDisabled();
    fireEvent.click(screen.getByTestId('cell-6'));
    expect(onMove).not.toHaveBeenCalled();
  });

  it('renders own safe / busted / mine cells; an uncovered square is never clickable', () => {
    const onMove = vi.fn();
    render(
      <MinesPlayScreen
        {...aliceProps}
        onMove={onMove}
        gameState={view({ uncovered: [0, 1], locked: true, bustedOn: 10, mines: [10, 20, 30] })}
        legalMoves={[]}
      />,
    );
    expect(kind(0)).toBe('safe');
    expect(kind(1)).toBe('safe');
    expect(kind(10)).toBe('bustedOn'); // the detonated mine wins over plain 'mine'
    expect(kind(20)).toBe('mine'); // layout revealed once locked
    expect(kind(30)).toBe('mine');
    expect(kind(2)).toBe('covered');

    // Locked → board frozen: an uncovered (or any) cell is not clickable.
    fireEvent.click(screen.getByTestId('cell-0'));
    fireEvent.click(screen.getByTestId('cell-2'));
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByTestId('my-status').textContent).toBe('Busted');
  });

  it('marks the board cleared (not busted) when locked with no bustedOn', () => {
    render(<MinesPlayScreen {...aliceProps} gameState={view({ uncovered: [0, 1, 2], locked: true })} legalMoves={[]} />);
    expect(screen.getByTestId('my-status').textContent).toBe('Board cleared');
  });

  it('HIDES the opponent count while both are active, and never renders an opponent board', () => {
    render(<MinesPlayScreen {...aliceProps} gameState={view({ uncovered: [1] }, { locked: false })} legalMoves={allCovered} />);
    const oppCount = screen.getByTestId('opponent-count');
    expect(oppCount.textContent).not.toMatch(/\d+ safe/); // no number leaked
    expect(oppCount.querySelector('[aria-label="hidden"]')).toBeInTheDocument();
    // Only the player's own 64 cells exist — the opponent's board is never in the DOM.
    expect(screen.getAllByRole('gridcell')).toHaveLength(64);
  });

  it('REVEALS the opponent count once it is provided (target / chase, server-gated on lock)', () => {
    // Opponent locked → server includes their final count as the target.
    render(<MinesPlayScreen {...aliceProps} gameState={view({ uncovered: [2] }, { locked: true, score: 7 })} legalMoves={allCovered} />);
    expect(screen.getByTestId('opponent-count').textContent).toContain('7 safe');
  });

  it('resets the board on an internal replay (a new round re-deals a fresh board)', () => {
    const { rerender } = render(
      <MinesPlayScreen {...aliceProps} gameState={view({ uncovered: [0, 1, 2] })} legalMoves={[3, 4, 5]} />,
    );
    expect(kind(0)).toBe('safe');
    expect(screen.queryByTestId('round-indicator')).not.toBeInTheDocument();

    // Draw → replay: round bumps, boards reset (no result shown — match keeps going).
    rerender(<MinesPlayScreen {...aliceProps} gameState={view({ uncovered: [] }, {}, { round: 1 })} legalMoves={allCovered} />);
    expect(kind(0)).toBe('covered'); // the previously-safe square is covered again
    expect(screen.getByTestId('cell-0')).not.toBeDisabled();
    expect(screen.getByTestId('round-indicator').textContent).toContain('Round 2');
  });

  it('shows a per-move countdown while active and hides it once locked', () => {
    const { rerender } = render(<MinesPlayScreen {...aliceProps} gameState={view({ uncovered: [] })} legalMoves={allCovered} />);
    expect(screen.getByTestId('move-timer').textContent).toBe('5s');

    rerender(<MinesPlayScreen {...aliceProps} gameState={view({ uncovered: [], locked: true })} legalMoves={[]} />);
    expect(screen.queryByTestId('move-timer')).not.toBeInTheDocument();
  });

  it('resign calls onForfeit (and is hidden once locked)', () => {
    const onForfeit = vi.fn();
    const { rerender } = render(
      <MinesPlayScreen {...aliceProps} onForfeit={onForfeit} gameState={view({ uncovered: [] })} legalMoves={allCovered} />,
    );
    fireEvent.click(screen.getByText('Resign'));
    expect(onForfeit).toHaveBeenCalledTimes(1);

    rerender(<MinesPlayScreen {...aliceProps} onForfeit={onForfeit} gameState={view({ uncovered: [], locked: true })} legalMoves={[]} />);
    expect(screen.queryByText('Resign')).not.toBeInTheDocument();
  });
});
