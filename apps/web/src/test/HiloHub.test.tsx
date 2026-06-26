// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HiloHubScreen } from '../screens/HiloHub.js';
import type { HiloView } from '../App.js';

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

type Props = Parameters<typeof HiloHubScreen>[0];
function baseProps(over: Partial<Props> = {}): Props {
  return {
    token: 'tok', playerId: 'alice', username: 'alice', opponentId: 'bob', balance: 1000,
    currentMatchId: null, gameState: null, legalMoves: [], waitingExpiresAt: null, lobbyExpired: false,
    lastOutcome: null, lastSettlement: null, challengesByGame: {},
    onPlay: vi.fn(), onCancel: vi.fn(), onRepost: vi.fn(), onTakeChallenge: vi.fn(),
    onMakeMove: vi.fn(), onForfeit: vi.fn(), onTrackChallenges: vi.fn(), onUntrackChallenges: vi.fn(),
    onSelectGame: vi.fn(), onOpenWallet: vi.fn(), onOpenGameList: vi.fn(), onResultDismiss: vi.fn(),
    ...over,
  };
}
function view(mine: HiloView['progress']['x'], over: Partial<HiloView> = {}): HiloView {
  return {
    players: ['alice', 'bob'], round: 0, replays: 0,
    startedAt: 1000, endsAt: 1000 + 30_000,
    progress: { alice: mine, bob: {} },
    ...over,
  };
}
const card = { rank: 9, suit: '♠' };
const inMatch = (over: Partial<Props> = {}) =>
  baseProps({ currentMatchId: 'm1', gameState: view({ position: 0, busted: false, frozen: false, card }), ...over });

describe('HiloHubScreen (GameHub + HiloPanel)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Idle: arming a bet enables PLAY', () => {
    const onPlay = vi.fn();
    render(<HiloHubScreen {...baseProps({ onPlay })} />);
    fireEvent.click(screen.getByTestId('hub-bet-5'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(5);
  });

  it('In-match: shows my card, streak, and Higher/Lower calls', () => {
    render(<HiloHubScreen {...inMatch()} />);
    expect(screen.getByTestId('hub-board')).toBeInTheDocument();
    expect(screen.getByTestId('hilo-card').textContent).toMatch(/9/);
    expect(screen.getByTestId('streak').textContent).toMatch(/0/);
    expect(screen.getByTestId('hi-btn')).toBeInTheDocument();
    expect(screen.getByTestId('lo-btn')).toBeInTheDocument();
  });

  it('Higher / Lower send the hi/lo calls', () => {
    const onMakeMove = vi.fn();
    render(<HiloHubScreen {...inMatch({ onMakeMove })} />);
    fireEvent.click(screen.getByTestId('hi-btn'));
    expect(onMakeMove).toHaveBeenCalledWith({ t: 'hi' });
    fireEvent.click(screen.getByTestId('lo-btn'));
    expect(onMakeMove).toHaveBeenCalledWith({ t: 'lo' });
  });

  it('busted: shows the finished banner (no call buttons) and the bust card', () => {
    render(<HiloHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ position: 3, busted: true, frozen: false, bustCard: { rank: 4, suit: '♦' } }) })} />);
    expect(screen.getByTestId('finished-banner').textContent).toMatch(/busted at 3/i);
    expect(screen.queryByTestId('hi-btn')).toBeNull();
  });

  it("Redaction: only my own card renders; the opponent's progress is not on the board", () => {
    const { container } = render(<HiloHubScreen {...inMatch()} />);
    // exactly one card face (mine) is shown.
    expect(container.querySelectorAll('[data-testid="hilo-card"]').length).toBe(1);
    expect(screen.getByTestId('hub-slot-opponent').textContent).toMatch(/playing/i);
  });

  it('is sanitized: no $ anywhere on the hub', () => {
    const { container } = render(<HiloHubScreen {...inMatch()} />);
    expect(container.textContent ?? '').not.toMatch(/\$/);
  });
});
