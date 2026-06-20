// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RpsHubScreen } from '../screens/RpsHub.js';
import type { RpsView } from '../App.js';

// canvas-confetti needs a real <canvas> (absent in jsdom) — mock it (matches the other hub tests).
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

type Props = Parameters<typeof RpsHubScreen>[0];

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

const CHALLENGE = { matchId: 'c1', ownerName: 'rival', stake: 50, openedAt: 0, expiresAt: Date.now() + 30_000, timeControlId: 'none' };

describe('RpsHubScreen (GameHub + RpsPanel)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Idle: arming a bet enables PLAY, which posts that stake (shared GameHub)', () => {
    const onPlay = vi.fn();
    render(<RpsHubScreen {...baseProps({ onPlay })} />);
    expect(screen.getByTestId('hub-play')).toBeDisabled();
    fireEvent.click(screen.getByTestId('hub-bet-25'));
    expect(screen.getByTestId('hub-play')).toBeEnabled();
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(25);
  });

  it('In-match: the RPS board activates, choices come from legalMoves, and the opponent stays hidden', () => {
    const onMakeMove = vi.fn();
    const gameState: RpsView = { players: ['pid', 'bob'], choices: {} };
    render(<RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['rock', 'paper', 'scissors'], onMakeMove })} />);
    expect(screen.getByTestId('hub-board')).toBeInTheDocument();
    // Redaction: the opponent's pick is never shown before match.end.
    expect(screen.getByTestId('hub-opponent-pick').textContent).toBe('🤫');
    fireEvent.click(screen.getByTestId('hub-move-rock'));
    expect(onMakeMove).toHaveBeenCalledWith('rock');
  });

  it('In-match: choices are disabled when it is not your turn (no legalMoves)', () => {
    const gameState: RpsView = { players: ['pid', 'bob'], choices: { pid: 'rock' } };
    render(<RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [] })} />);
    expect(screen.getByTestId('hub-move-rock')).toBeDisabled();
    expect(screen.getByTestId('hub-move-scissors')).toBeDisabled();
  });

  it('Result: ending a match shows the overlay with the ¢ delta and the both-choices reveal', async () => {
    const gameState: RpsView = { players: ['pid', 'bob'], choices: { pid: 'rock', bob: 'scissors' } };
    const { rerender } = render(<RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [] })} />);
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull();
    rerender(
      <RpsHubScreen
        {...baseProps({ currentMatchId: null, gameState, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 9, newBalance: 1009 } })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('hub-result-overlay')).toBeInTheDocument());
    expect(screen.getByTestId('hub-result-text').textContent).toContain('You Won');
    expect(screen.getByTestId('hub-result-delta').textContent).toBe('+9¢');
    // Both choices are revealed at terminal (server-authoritative).
    expect(screen.getByTestId('hub-result-rps')).toBeInTheDocument();
  });

  it('JOIN balance-check + chrome + no $ (shared GameHub behaviour holds for RPS)', () => {
    const onTakeChallenge = vi.fn();
    const { container } = render(<RpsHubScreen {...baseProps({ balance: 5, challenges: [CHALLENGE], onTakeChallenge })} />);
    expect(screen.getByTestId('hub-stake-c1').textContent).toBe('50¢');
    fireEvent.click(screen.getByTestId('hub-join-c1'));
    expect(onTakeChallenge).not.toHaveBeenCalled();
    expect(screen.getByTestId('hub-challenge-notice').textContent).toMatch(/not enough/i);
    expect(container.textContent ?? '').not.toMatch(/\$/);
  });
});
