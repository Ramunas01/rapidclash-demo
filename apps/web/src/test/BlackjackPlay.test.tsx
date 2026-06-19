// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { BlackjackPlayScreen } from '../screens/BlackjackPlay.js';
import type { BlackjackView } from '../App.js';

const aliceProps = { playerId: 'alice', username: 'alice', opponentId: 'bob', onMove: vi.fn(), onForfeit: vi.fn() };
const PLAY_MOVES = ['hit', 'stand'];

function view(partial: Partial<BlackjackView> = {}): BlackjackView {
  return {
    players: ['alice', 'bob'],
    round: 0,
    draws: 0,
    hands: {
      alice: { cards: [{ rank: '10', suit: '♠' }, { rank: '9', suit: '♥' }], done: false },
      // Redacted by viewFor in play: the opponent shows exactly ONE card.
      bob: { cards: [{ rank: 'K', suit: '♣' }], done: false },
    },
    ...partial,
  };
}

describe('BlackjackPlayScreen', () => {
  it('renders own cards fully and exactly one opponent card (viewFor redaction)', () => {
    render(<BlackjackPlayScreen {...aliceProps} gameState={view()} legalMoves={PLAY_MOVES} />);
    const own = within(screen.getByTestId('own-hand'));
    const opp = within(screen.getByTestId('opp-hand'));
    expect(own.getAllByTestId('card')).toHaveLength(2); // both own cards
    expect(opp.getAllByTestId('card')).toHaveLength(1); // EXACTLY one opponent card
    expect(opp.getAllByTestId('card-back')).toHaveLength(1); // remainder hidden
    expect(screen.getByTestId('own-total').textContent).toBe('19'); // 10 + 9
  });

  it('shows whose turn it is and a countdown when it is this player’s turn', () => {
    const { rerender } = render(
      <BlackjackPlayScreen {...aliceProps} gameState={view()} legalMoves={PLAY_MOVES} />,
    );
    expect(screen.getByTestId('turn-indicator').textContent).toContain('Your turn');
    expect(screen.getByTestId('countdown').textContent).toMatch(/\d+s/);

    rerender(<BlackjackPlayScreen {...aliceProps} gameState={view()} legalMoves={[]} />);
    expect(screen.getByTestId('turn-indicator').textContent).toContain('Waiting');
    expect(screen.queryByTestId('countdown')).not.toBeInTheDocument();
  });

  it('sends hit / stand via onMove only when it is this player’s turn', () => {
    const onMove = vi.fn();
    const { rerender } = render(
      <BlackjackPlayScreen {...aliceProps} onMove={onMove} gameState={view()} legalMoves={PLAY_MOVES} />,
    );
    fireEvent.click(screen.getByTestId('hit-btn'));
    fireEvent.click(screen.getByTestId('stand-btn'));
    expect(onMove).toHaveBeenNthCalledWith(1, 'hit');
    expect(onMove).toHaveBeenNthCalledWith(2, 'stand');

    // Not my turn → buttons disabled, no further calls.
    onMove.mockClear();
    rerender(<BlackjackPlayScreen {...aliceProps} onMove={onMove} gameState={view()} legalMoves={[]} />);
    expect(screen.getByTestId('hit-btn')).toBeDisabled();
    fireEvent.click(screen.getByTestId('hit-btn'));
    expect(onMove).not.toHaveBeenCalled();
  });

  it('flags a bust on the own total', () => {
    const bust = view({
      hands: {
        alice: { cards: [{ rank: 'K', suit: '♠' }, { rank: 'Q', suit: '♥' }, { rank: '5', suit: '♦' }], done: true },
        bob: { cards: [{ rank: '7', suit: '♣' }], done: false },
      },
    });
    render(<BlackjackPlayScreen {...aliceProps} gameState={bust} legalMoves={[]} />);
    expect(screen.getByTestId('own-total').textContent).toBe('25');
    expect(screen.getByTestId('turn-indicator').textContent).toContain('Bust');
  });

  it('treats a draw re-deal as a fresh round, NOT a match end (internal replay)', () => {
    // A draw re-deals within the same match: round/draws advance, new 2-card hands, play continues.
    const replay = view({
      round: 1,
      draws: 1,
      hands: {
        alice: { cards: [{ rank: '8', suit: '♠' }, { rank: '7', suit: '♥' }], done: false },
        bob: { cards: [{ rank: '5', suit: '♣' }], done: false },
      },
    });
    render(<BlackjackPlayScreen {...aliceProps} gameState={replay} legalMoves={PLAY_MOVES} />);
    // Still the play screen with live actions — the result overlay is the App's job on match.end.
    expect(screen.getByTestId('hit-btn')).toBeEnabled();
    expect(screen.getByTestId('round-note').textContent).toContain('Round 2');
    expect(screen.getByTestId('round-note').textContent).toContain('push');
    expect(screen.getByTestId('own-total').textContent).toBe('15');
  });

  it('resign calls onForfeit', () => {
    const onForfeit = vi.fn();
    render(<BlackjackPlayScreen {...aliceProps} onForfeit={onForfeit} gameState={view()} legalMoves={PLAY_MOVES} />);
    fireEvent.click(screen.getByText('Resign'));
    expect(onForfeit).toHaveBeenCalledTimes(1);
  });
});
