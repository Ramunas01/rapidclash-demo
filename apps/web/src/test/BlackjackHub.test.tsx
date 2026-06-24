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
    lastOutcome: null, lastSettlement: null, challengesByGame: {},
    onPlay: vi.fn(), onCancel: vi.fn(), onRepost: vi.fn(), onTakeChallenge: vi.fn(),
    onMakeMove: vi.fn(), onForfeit: vi.fn(), onTrackChallenges: vi.fn(), onUntrackChallenges: vi.fn(),
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

  it('Idle board (item 1): the empty greyish table shows the "Place your bet and play" prompt', () => {
    render(<BlackjackHubScreen {...baseProps()} />);
    const board = screen.getByTestId('hub-board');
    expect(board.textContent).toMatch(/place your bet and play/i);
    // No live cards on the empty table (the right-edge decks are decorative, not `card`s).
    expect(within(board).queryByTestId('card')).toBeNull();
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

  it('Item 2: match.end shows NO pop-up — the final cards persist on the board (both hands revealed)', async () => {
    const terminal = inPlayView({
      hands: {
        pid: { cards: [{ rank: 'K', suit: '♠' }, { rank: 'Q', suit: '♥' }], done: true }, // 20
        bob: { cards: [{ rank: '9', suit: '♣' }, { rank: '8', suit: '♦' }], done: true }, // 17
      },
      winner: 'pid',
    });
    const { rerender } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: terminal, legalMoves: [] })} />);
    rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019 } })} />);
    // Blackjack opts OUT of the shared result pop-up.
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull();
    // The board stays up with BOTH hands revealed (no face-down) — the final cards persist.
    expect(screen.getByTestId('hub-board')).toBeInTheDocument();
    expect(within(screen.getByTestId('own-hand')).getAllByTestId('card')).toHaveLength(2);
    expect(within(screen.getByTestId('opp-hand')).getAllByTestId('card')).toHaveLength(2);
    expect(screen.queryByTestId('card-back')).toBeNull();
    // No wallet / balance-change result text anywhere (only the live ribbon chip updates).
    expect(screen.queryByText(/wallet change/i)).toBeNull();
    expect(screen.queryByText(/new balance/i)).toBeNull();
    // It never pops the overlay even after a beat.
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull();
  });

  it('Item 2: a beat after the reveal a green frame rings the player\'s own cards on a win (server outcome)', async () => {
    const terminal = inPlayView({
      hands: {
        pid: { cards: [{ rank: 'K', suit: '♠' }, { rank: 'Q', suit: '♥' }], done: true },
        bob: { cards: [{ rank: '9', suit: '♣' }, { rank: '8', suit: '♦' }], done: true },
      },
      winner: 'pid',
    });
    const { rerender } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: terminal, legalMoves: [] })} />);
    rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019 } })} />);
    // The win frame lands a beat after the reveal (FRAME_DELAY_MS) and stays.
    await waitFor(() => {
      for (const c of within(screen.getByTestId('own-hand')).getAllByTestId('card')) {
        expect(c.className).toMatch(/ring-success/);
      }
    }, { timeout: 2000 });
    // The opponent's cards are never framed; the frame is the player's own win/lose only.
    for (const c of within(screen.getByTestId('opp-hand')).getAllByTestId('card')) {
      expect(c.className).not.toMatch(/ring-success|ring-destructive/);
    }
  });

  it('Item 2: a loss rings the own cards red; a draw rings nothing (server outcome only)', async () => {
    const terminal = inPlayView({
      hands: {
        pid: { cards: [{ rank: '9', suit: '♠' }, { rank: '8', suit: '♥' }], done: true },
        bob: { cards: [{ rank: 'K', suit: '♣' }, { rank: 'Q', suit: '♦' }], done: true },
      },
      winner: 'bob',
    });
    const { rerender, unmount } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: terminal, legalMoves: [] })} />);
    // A loss is the server outcome `type:'win'` with the OPPONENT as winner (there is no 'lose').
    rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'bob' }, lastSettlement: { delta: -10, newBalance: 990 } })} />);
    await waitFor(() => {
      expect(within(screen.getByTestId('own-hand')).getAllByTestId('card')[0].className).toMatch(/ring-destructive/);
    }, { timeout: 2000 });
    unmount();

    // A draw is a non win/lose terminal → no frame (neutral, handled gracefully).
    const drawView = inPlayView({
      hands: {
        pid: { cards: [{ rank: 'K', suit: '♠' }, { rank: '9', suit: '♥' }], done: true },
        bob: { cards: [{ rank: 'K', suit: '♣' }, { rank: '9', suit: '♦' }], done: true },
      },
      forcedOutcome: { type: 'draw' },
    });
    const { rerender: rr2 } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm2', gameState: drawView, legalMoves: [] })} />);
    rr2(<BlackjackHubScreen {...baseProps({ currentMatchId: null, gameState: drawView, lastOutcome: { type: 'draw' }, lastSettlement: { delta: 0, newBalance: 1000 } })} />);
    await new Promise((r) => setTimeout(r, 1200));
    for (const c of within(screen.getByTestId('own-hand')).getAllByTestId('card')) {
      expect(c.className).not.toMatch(/ring-success|ring-destructive/);
    }
  });

  it('Item 2: after match.end the play button returns to PLAY (not "Playing…") to start a new game', () => {
    const terminal = inPlayView({
      hands: {
        pid: { cards: [{ rank: 'K', suit: '♠' }, { rank: 'Q', suit: '♥' }], done: true },
        bob: { cards: [{ rank: '9', suit: '♣' }, { rank: '8', suit: '♦' }], done: true },
      },
      winner: 'pid',
    });
    const { rerender } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: terminal, legalMoves: [] })} />);
    expect(screen.getByTestId('hub-play').textContent).toMatch(/playing/i); // in-match
    rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019 } })} />);
    // Result phase: PLAY is back (panel unfrozen) so a new game can start; bet re-enabled.
    const play = screen.getByTestId('hub-play');
    expect(play.textContent).toMatch(/play/i);
    expect(play.textContent).not.toMatch(/playing/i);
    expect(screen.getByTestId('hub-bet-10')).not.toBeDisabled();
  });

  it('Item 6: Hit/Stand live in the player\'s own slot pill (not on the table)', () => {
    render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'] })} />);
    const ownPill = screen.getByTestId('hub-slot-own');
    expect(within(ownPill).getByTestId('hit-btn')).toBeInTheDocument();
    expect(within(ownPill).getByTestId('stand-btn')).toBeInTheDocument();
    // The table no longer carries an on-board Resign control or rules blurb.
    expect(screen.queryByText(/resign/i)).toBeNull();
    expect(screen.queryByText(/closest to 21/i)).toBeNull();
    expect(screen.queryByText(/your turn/i)).toBeNull();
  });

  it('Item 7: in-match freezes the play panel — PLAY reads "Playing…" (disabled), bet stays', () => {
    render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'] })} />);
    const play = screen.getByTestId('hub-play');
    expect(play.textContent).toMatch(/playing/i);
    expect(play).toBeDisabled();
    // Bet amount + Play-a-Friend stay visible but disabled (not removed).
    expect(screen.getByTestId('hub-bet-10')).toBeDisabled();
    expect(screen.getByTestId('hub-play-friend')).toBeInTheDocument();
  });

  it('Item 2: the "Searching…" beat never fabricates a name (empty online list)', () => {
    // Waiting with no online players in the cross-game feed → just "Searching…", no scan name,
    // and never the opponentId.
    render(<BlackjackHubScreen {...baseProps({ waitingExpiresAt: Date.now() + 30_000, challengesByGame: {} })} />);
    const opp = screen.getByTestId('hub-slot-opponent');
    expect(opp.textContent).toMatch(/searching/i);
    expect(screen.queryByTestId('hub-search-scan')).toBeNull();
    expect(opp.textContent).not.toMatch(/bob/); // opponentId is never shown
  });

  it('Item 2: in-match shows a neutral "Opponent" when the joiner\'s name is unknown (never the id)', () => {
    render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: [] })} />);
    const opp = screen.getByTestId('hub-slot-opponent');
    expect(opp.textContent).toContain('Opponent');
    expect(opp.textContent).not.toMatch(/bob/);
  });

  it('Item 2: in-match shows the REAL opponent name (from a joined challenge) in the slot', () => {
    render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: [], opponentName: 'Povcnent' })} />);
    expect(screen.getByTestId('hub-slot-opponent').textContent).toContain('Povcnent');
  });

  it('is sanitized: no $ anywhere on the hub', () => {
    const { container } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'] })} />);
    expect(container.textContent ?? '').not.toMatch(/\$/);
  });
});
