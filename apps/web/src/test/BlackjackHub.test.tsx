// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { BlackjackHubScreen } from '../screens/BlackjackHub.js';
import type { BlackjackView } from '../App.js';

// canvas-confetti needs a real <canvas> (absent in jsdom) — mock it (matches the other hub tests).
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

type Props = Parameters<typeof BlackjackHubScreen>[0];

function baseProps(over: Partial<Props> = {}): Props {
  return {
    token: 'tok', playerId: 'pid', username: 'me', opponentId: 'bob', balance: 1000,
    currentMatchId: null, gameState: null, legalMoves: [], waitingExpiresAt: null, lobbyExpired: false,
    lastOutcome: null, lastSettlement: null, challenges: [], challengeNotice: null,
    onPlay: vi.fn(), onCancel: vi.fn(), onRepost: vi.fn(), onTakeChallenge: vi.fn(),
    onMakeMove: vi.fn(), onForfeit: vi.fn(), onSubscribe: vi.fn(), onUnsubscribe: vi.fn(),
    onSelectGame: vi.fn(), onOpenWallet: vi.fn(), onOpenGameList: vi.fn(), onResultDismiss: vi.fn(),
    ...over,
  };
}

/** In-play view: own hand full (2 cards), opponent redacted to exactly ONE card. */
function inPlayView(over: Partial<BlackjackView> = {}): BlackjackView {
  return {
    players: ['pid', 'bob'],
    round: 0,
    draws: 0,
    hands: {
      pid: { cards: [{ rank: '10', suit: '♠' }, { rank: '7', suit: '♥' }], done: false },
      bob: { cards: [{ rank: 'K', suit: '♣' }], done: false },
    },
    ...over,
  };
}

describe('BlackjackHubScreen (GameHub + BlackjackPanel)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Idle: arming a bet enables PLAY (shared GameHub)', () => {
    const onPlay = vi.fn();
    render(<BlackjackHubScreen {...baseProps({ onPlay })} />);
    expect(screen.getByTestId('hub-play')).toBeDisabled();
    fireEvent.click(screen.getByTestId('hub-bet-10'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(10);
  });

  it('In-match: own hand in full, EXACTLY one opponent card + a face-down (redaction)', () => {
    render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'] })} />);
    expect(screen.getByTestId('hub-board')).toBeInTheDocument();
    const own = within(screen.getByTestId('own-hand'));
    const opp = within(screen.getByTestId('opp-hand'));
    expect(own.getAllByTestId('card')).toHaveLength(2); // own hand fully shown
    expect(opp.getAllByTestId('card')).toHaveLength(1); // EXACTLY one opponent card
    expect(opp.getByTestId('card-back')).toBeInTheDocument(); // the rest stays hidden
    expect(screen.getByTestId('own-total').textContent).toBe('17'); // 10 + 7
  });

  it('In-match: Hit/Stand gated by legalMoves → onMove', () => {
    const onMakeMove = vi.fn();
    const { rerender } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'], onMakeMove })} />);
    fireEvent.click(screen.getByTestId('hit-btn'));
    expect(onMakeMove).toHaveBeenCalledWith('hit');
    fireEvent.click(screen.getByTestId('stand-btn'));
    expect(onMakeMove).toHaveBeenCalledWith('stand');
    // Not your turn (no legalMoves) → both disabled.
    rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: [] })} />);
    expect(screen.getByTestId('hit-btn')).toBeDisabled();
    expect(screen.getByTestId('stand-btn')).toBeDisabled();
  });

  it('Internal replay: a re-dealt round keeps the board (NOT the result overlay)', () => {
    const replay = inPlayView({
      round: 1,
      draws: 1,
      hands: {
        pid: { cards: [{ rank: '9', suit: '♠' }, { rank: '8', suit: '♥' }], done: false },
        bob: { cards: [{ rank: '4', suit: '♣' }], done: false },
      },
    });
    render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: replay, legalMoves: ['hit', 'stand'] })} />);
    expect(screen.getByTestId('hub-board')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull(); // a draw re-deal is NOT a match end
    expect(screen.getByTestId('round-note').textContent).toContain('Round 2');
    expect(screen.getByTestId('round-note').textContent).toContain('push');
  });

  it('Result: a decisive match.end shows the overlay with the ¢ delta + final totals', async () => {
    const terminal = inPlayView({
      hands: {
        pid: { cards: [{ rank: 'K', suit: '♠' }, { rank: 'Q', suit: '♥' }], done: true }, // 20
        bob: { cards: [{ rank: '9', suit: '♣' }, { rank: '8', suit: '♦' }], done: true }, // 17
      },
      winner: 'pid',
    });
    const { rerender } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: terminal, legalMoves: [] })} />);
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull();
    rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019 } })} />);
    await waitFor(() => expect(screen.getByTestId('hub-result-overlay')).toBeInTheDocument());
    expect(screen.getByTestId('hub-result-text').textContent).toContain('You Won');
    expect(screen.getByTestId('hub-result-delta').textContent).toBe('+19¢');
    const reveal = within(screen.getByTestId('hub-result-blackjack'));
    expect(reveal.getByText('20')).toBeInTheDocument();
    expect(reveal.getByText('17')).toBeInTheDocument();
  });

  it('is sanitized: no $ anywhere on the hub', () => {
    const { container } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'] })} />);
    expect(container.textContent ?? '').not.toMatch(/\$/);
  });
});
