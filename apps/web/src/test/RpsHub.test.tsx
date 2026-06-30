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
    lastOutcome: null, lastSettlement: null, challengesByGame: {},
    onPlay: vi.fn(), onCancel: vi.fn(), onRepost: vi.fn(), onTakeChallenge: vi.fn(),
    onMakeMove: vi.fn(), onForfeit: vi.fn(), onTrackChallenges: vi.fn(), onUntrackChallenges: vi.fn(),
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
    expect(screen.getByTestId('hub-play')).toBeEnabled(); // #143: pressable even with no stake armed
    fireEvent.click(screen.getByTestId('hub-bet-25'));
    expect(screen.getByTestId('hub-play')).toBeEnabled();
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(25);
  });

  it('#143: PLAY with no bet armed guides to the bet panel (no match starts); arming clears the cue, no auto-play', () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const onPlay = vi.fn();
    render(<RpsHubScreen {...baseProps({ onPlay })} />);

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

  it('#143: the inert "Play a Friend" also guides to the bet panel when no stake is armed (guard pre-wired)', () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    render(<RpsHubScreen {...baseProps()} />);
    fireEvent.click(screen.getByTestId('hub-play-friend'));
    expect(scrollSpy).toHaveBeenCalled();
    expect(screen.getByTestId('hub-bet-hint').textContent).toMatch(/select a bet/i);
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
    const { container } = render(<RpsHubScreen {...baseProps({ balance: 5, challengesByGame: { rps: [CHALLENGE] }, onTakeChallenge })} />);
    expect(screen.getByTestId('home-stake-c1').textContent).toBe('50¢');
    fireEvent.click(screen.getByTestId('home-join-c1'));
    expect(onTakeChallenge).not.toHaveBeenCalled();
    expect(screen.getByTestId('home-ticker-notice').textContent).toMatch(/not enough/i);
    expect(container.textContent ?? '').not.toMatch(/\$/);
  });
});

describe('GameHub (logged out — via RpsHub)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('browsing stays open: the bet selector works + PLAY arms, but the chip is "Sign in" and the feed is a teaser', () => {
    const onPlay = vi.fn();
    const onTrackChallenges = vi.fn();
    render(<RpsHubScreen {...baseProps({ loggedIn: false, token: '', onPlay, onTrackChallenges })} />);
    // Sign-in chip, not a fake balance; the open-challenges feed is a teaser (no live rows).
    expect(screen.getByTestId('hub-signin-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-wallet-chip')).toBeNull();
    expect(screen.getByTestId('hub-section-challenges-teaser')).toBeInTheDocument();
    expect(screen.queryByTestId('home-ticker')).toBeNull(); // the live cross-game ticker is auth-only
    expect(onTrackChallenges).not.toHaveBeenCalled(); // no WS feed while logged out
    // Browsing + arming a bet is allowed; the auth wall fires in the App at PLAY.
    fireEvent.click(screen.getByTestId('hub-bet-10'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(10);
  });

  it('initialStake pre-arms the bet (the join-fallback lands here ready to post)', () => {
    render(<RpsHubScreen {...baseProps({ initialStake: 25 })} />);
    expect(screen.getByTestId('hub-play')).toBeEnabled(); // pre-armed → PLAY ready immediately
  });
});
