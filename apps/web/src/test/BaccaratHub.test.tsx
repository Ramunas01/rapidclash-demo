// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BaccaratHubScreen } from '../screens/BaccaratHub.js';
import type { BaccaratView } from '../App.js';

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));
type Props = Parameters<typeof BaccaratHubScreen>[0];

function baseProps(over: Partial<Props> = {}): Props {
  return {
    token: 'tok', playerId: 'me', username: 'me', opponentId: 'opp', balance: 1000, serverClockOffset: 0,
    currentMatchId: null, gameState: null, legalMoves: [], waitingExpiresAt: null, lobbyExpired: false,
    lastOutcome: null, lastSettlement: null, challengesByGame: {},
    onPlay: vi.fn(), onCancel: vi.fn(), onRepost: vi.fn(), onTakeChallenge: vi.fn(),
    onMakeMove: vi.fn(), onForfeit: vi.fn(), onTrackChallenges: vi.fn(), onUntrackChallenges: vi.fn(),
    onSelectGame: vi.fn(), onOpenWallet: vi.fn(), onOpenGameList: vi.fn(), onResultDismiss: vi.fn(),
    ...over,
  };
}
// Pre-deal: the viewer sees their OWN hand; the opponent's is withheld.
const preDeal = (): BaccaratView => ({
  players: ['me', 'opp'], seeds: {}, round: 0, replays: 0, revealed: {},
  hands: { me: { cards: [{ rank: '7', suit: '♠' }, { rank: '2', suit: '♥' }], total: 9, natural: true } },
});
const resolved = (): BaccaratView => ({
  players: ['me', 'opp'], seeds: { me: 1, opp: 2 }, round: 0, replays: 0, revealed: { me: true, opp: true },
  result: { hands: {
    me: { cards: [{ rank: '7', suit: '♠' }, { rank: '2', suit: '♥' }], total: 9, natural: true },
    opp: { cards: [{ rank: '5', suit: '♣' }, { rank: 'K', suit: '♦' }], total: 5, natural: false },
  }, round: 0 }, winner: 'me',
});

describe('BaccaratHubScreen', () => {
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
    render(<BaccaratHubScreen {...baseProps({ onPlay })} />);
    fireEvent.click(screen.getByTestId('hub-bet-10'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(10);
  });

  it('#143: PLAY with no bet armed guides to the bet panel (no match starts); arming clears the cue, no auto-play', () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const onPlay = vi.fn();
    render(<BaccaratHubScreen {...baseProps({ onPlay })} />);

    const play = screen.getByTestId('hub-play');
    expect(play).toBeEnabled(); // pressable with no stake armed (no longer a dead end)
    fireEvent.click(play);
    expect(onPlay).not.toHaveBeenCalled(); // guided to the bet panel, not started
    expect(scrollSpy).toHaveBeenCalled(); // bet panel scrolled into view
    expect(screen.getByTestId('hub-section-bet').getAttribute('data-needs-bet')).toBe('true');
    expect(screen.getByTestId('hub-bet-hint').textContent).toMatch(/select a bet/i);

    fireEvent.click(screen.getByTestId('hub-bet-10')); // selecting a bet clears the frame + hint…
    expect(screen.getByTestId('hub-section-bet').getAttribute('data-needs-bet')).toBeNull();
    expect(screen.getByTestId('hub-bet-hint').textContent).toBe('');
    expect(onPlay).not.toHaveBeenCalled(); // …with NO auto-play
  });

  it('In-match: auto-commits the reveal, shows OWN hand, hides the opponent', () => {
    const onMakeMove = vi.fn();
    render(<BaccaratHubScreen {...baseProps({ currentMatchId: 'm1', gameState: preDeal(), legalMoves: ['reveal'], onMakeMove })} />);
    expect(onMakeMove).toHaveBeenCalledWith('reveal'); // auto-fired
    expect(screen.getByTestId('bac-status').textContent).toMatch(/dealing/i);
    // own hand face-up (rank visible); opponent face-down placeholders
    expect(screen.getAllByTestId('card').length).toBe(2);
    expect(screen.getAllByTestId('card-back').length).toBeGreaterThan(0);
    expect(screen.getByTestId('hub-board').textContent).toContain('7');
  });

  it('Resolved: reveals both hands and the closer-to-9 winner', () => {
    render(<BaccaratHubScreen {...baseProps({ currentMatchId: 'm1', gameState: resolved() })} />);
    const board = screen.getByTestId('hub-board').textContent ?? '';
    expect(board).toContain('9'); // my total
    expect(board).toContain('5'); // opponent total
    expect(screen.getByTestId('bac-status').textContent).toMatch(/closer to 9/i);
    expect(screen.queryByTestId('card-back')).toBeNull(); // nothing hidden anymore
  });

  it('is sanitized: no $ anywhere on the hub', () => {
    const { container } = render(<BaccaratHubScreen {...baseProps({ currentMatchId: 'm1', gameState: resolved() })} />);
    expect(container.textContent ?? '').not.toMatch(/\$/);
  });
});
