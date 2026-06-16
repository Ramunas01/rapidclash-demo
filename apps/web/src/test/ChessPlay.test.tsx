// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ChessPlayScreen } from '../screens/ChessPlay.js';
import type { ChessView, ChessMove } from '../App.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// alice = white (players[0]); bob = black (players[1]).
const aliceProps = { playerId: 'alice', username: 'alice', opponentId: 'bob', onMove: vi.fn(), onForfeit: vi.fn() };
const bobProps = { playerId: 'bob', username: 'bob', opponentId: 'alice', onMove: vi.fn(), onForfeit: vi.fn() };

function view(partial: Partial<ChessView>): ChessView {
  return { players: ['alice', 'bob'], fen: START_FEN, ...partial };
}

/** A couple of white opening moves in the module's {from,to} shape. */
const OPENING_MOVES: ChessMove[] = [
  { from: 'e2', to: 'e4' },
  { from: 'e2', to: 'e3' },
  { from: 'd2', to: 'd4' },
  { from: 'g1', to: 'f3' },
];

function square(container: HTMLElement, sq: string): HTMLElement {
  const el = container.querySelector(`[data-square="${sq}"]`);
  if (!el) throw new Error(`square ${sq} not rendered`);
  return el as HTMLElement;
}

describe('ChessPlayScreen', () => {
  it('renders the board from the server FEN with all 64 squares', () => {
    const { container } = render(
      <ChessPlayScreen {...aliceProps} gameState={view({})} legalMoves={OPENING_MOVES} />,
    );
    expect(screen.getByTestId('chess-board')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-square]').length).toBe(64);
    expect(screen.getByTestId('play-you').textContent).toContain('alice');
  });

  it('shows whose turn it is, driven by the presence of legalMoves (your_turn)', () => {
    const { rerender } = render(
      <ChessPlayScreen {...aliceProps} gameState={view({})} legalMoves={OPENING_MOVES} />,
    );
    expect(screen.getByTestId('turn-indicator').textContent).toBe('Your move');

    // No legalMoves → it is the opponent's turn (server only sends moves on your_turn).
    rerender(<ChessPlayScreen {...aliceProps} gameState={view({})} legalMoves={[]} />);
    expect(screen.getByTestId('turn-indicator').textContent).toBe("Opponent's move");
  });

  it('sends a move via onMove in the module {from,to} shape (click source, then target)', () => {
    const onMove = vi.fn();
    const { container } = render(
      <ChessPlayScreen {...aliceProps} onMove={onMove} gameState={view({})} legalMoves={OPENING_MOVES} />,
    );
    fireEvent.click(square(container, 'e2')); // select the pawn
    fireEvent.click(square(container, 'e4')); // push it
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith({ from: 'e2', to: 'e4' });
  });

  it('does NOT send an illegal target (only server-issued legalMoves are sendable)', () => {
    const onMove = vi.fn();
    const { container } = render(
      <ChessPlayScreen {...aliceProps} onMove={onMove} gameState={view({})} legalMoves={OPENING_MOVES} />,
    );
    fireEvent.click(square(container, 'e2'));
    fireEvent.click(square(container, 'e5')); // e2-e5 is not a legal move
    expect(onMove).not.toHaveBeenCalled();
  });

  it('opens a promotion picker and sends the chosen piece in the move shape', () => {
    const onMove = vi.fn();
    // White pawn on a7 ready to promote on a8 — server sends one move per promotion piece.
    const promoFen = '8/P6k/8/8/8/8/7K/8 w - - 0 1';
    const promoMoves: ChessMove[] = [
      { from: 'a7', to: 'a8', promotion: 'q' },
      { from: 'a7', to: 'a8', promotion: 'r' },
      { from: 'a7', to: 'a8', promotion: 'b' },
      { from: 'a7', to: 'a8', promotion: 'n' },
    ];
    const { container } = render(
      <ChessPlayScreen {...aliceProps} onMove={onMove} gameState={view({ fen: promoFen })} legalMoves={promoMoves} />,
    );
    fireEvent.click(square(container, 'a7'));
    fireEvent.click(square(container, 'a8'));
    // Move not sent yet — the piece choice is required first.
    expect(onMove).not.toHaveBeenCalled();
    const picker = screen.getByTestId('promotion-picker');
    fireEvent.click(within(picker).getByTestId('promote-r'));
    expect(onMove).toHaveBeenCalledWith({ from: 'a7', to: 'a8', promotion: 'r' });
  });

  it('flags check from the FEN', () => {
    // Black king on e8 checked by a white rook on e1 — black to move and in check.
    const checkFen = '4k3/8/8/8/8/8/8/4R1K1 b - - 0 1';
    render(<ChessPlayScreen {...bobProps} gameState={view({ fen: checkFen })} legalMoves={[]} />);
    expect(screen.getByTestId('check-badge')).toBeInTheDocument();
  });

  it('does not flag check in the starting position', () => {
    render(<ChessPlayScreen {...aliceProps} gameState={view({})} legalMoves={OPENING_MOVES} />);
    expect(screen.queryByTestId('check-badge')).not.toBeInTheDocument();
  });

  it('resign calls onForfeit', () => {
    const onForfeit = vi.fn();
    render(<ChessPlayScreen {...aliceProps} onForfeit={onForfeit} gameState={view({})} legalMoves={OPENING_MOVES} />);
    fireEvent.click(screen.getByText('Resign'));
    expect(onForfeit).toHaveBeenCalledTimes(1);
  });
});
