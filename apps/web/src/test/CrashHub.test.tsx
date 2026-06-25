// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CrashHubScreen } from '../screens/CrashHub.js';
import type { CrashView } from '../App.js';

// canvas-confetti needs a real <canvas> (absent in jsdom) — mock it (matches the other hub tests).
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

type Props = Parameters<typeof CrashHubScreen>[0];

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

/** A live Crash view: the round launched a few seconds ago, this player still aboard. */
function inPlayView(over: Partial<CrashView> = {}): CrashView {
  return { players: ['pid', 'bob'], startedAt: Date.now() - 3000, results: {}, ...over };
}

describe('CrashHubScreen (GameHub + CrashPanel)', () => {
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
    render(<CrashHubScreen {...baseProps({ onPlay })} />);
    expect(screen.getByTestId('hub-play')).toBeDisabled();
    fireEvent.click(screen.getByTestId('hub-bet-10'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(10);
  });

  it('Idle board: shows the launch prompt and no live altitude/eject', () => {
    render(<CrashHubScreen {...baseProps()} />);
    const board = screen.getByTestId('hub-board');
    expect(board.textContent).toMatch(/place your bet and launch/i);
    expect(within(board).queryByTestId('crash-eject')).toBeNull();
  });

  it('Pre-launch: shows the 3-2-1 countdown with EJECT disabled (server-authoritative pad)', () => {
    const view = inPlayView({ startedAt: Date.now() + 2000 }); // launches in ~2s
    render(<CrashHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view, legalMoves: ['eject'] })} />);
    expect(screen.getByTestId('crash-countdown').textContent).toMatch(/launching in/i);
    expect(screen.getByTestId('crash-eject')).toBeDisabled(); // a pad tap can't waste the eject
    expect(screen.queryByTestId('crash-altitude')).toBeNull(); // no altitude until the climb begins
  });

  it('In-match: a climbing altitude + EJECT gated by legalMoves → onMove("eject")', () => {
    const onMakeMove = vi.fn();
    const { rerender } = render(
      <CrashHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['eject'], onMakeMove })} />,
    );
    expect(screen.getByTestId('crash-altitude')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('crash-eject'));
    expect(onMakeMove).toHaveBeenCalledWith('eject');

    // No legal moves (already resolved / not actionable) → EJECT disabled.
    rerender(<CrashHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: [] })} />);
    expect(screen.getByTestId('crash-eject')).toBeDisabled();
  });

  it('In-match: after my own ejection the bank shows and EJECT is gone (own eject seen at once)', () => {
    const view = inPlayView({ results: { pid: { altitude: 120, crashed: false } } });
    render(<CrashHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view, legalMoves: [] })} />);
    expect(screen.getByTestId('crash-own-result').textContent).toMatch(/ejected at 120 m/i);
    expect(screen.queryByTestId('crash-eject')).toBeNull();
  });

  it('Result: a decisive match.end reveals C + both banks with the ¢ delta', async () => {
    const terminal = inPlayView({
      crashAltitude: 904,
      terminal: true,
      results: { pid: { altitude: 250, crashed: false }, bob: { altitude: 0, crashed: true } },
    });
    const { rerender } = render(<CrashHubScreen {...baseProps({ currentMatchId: 'm1', gameState: terminal, legalMoves: [] })} />);
    rerender(<CrashHubScreen {...baseProps({ currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019 } })} />);
    const reveal = await screen.findByTestId('hub-result-crash');
    expect(reveal.textContent).toMatch(/crashed at 904 m/i);
    expect(reveal.textContent).toContain('250 m');
    expect(screen.getByTestId('hub-result-delta').textContent).toBe('+19¢');
  });

  it('is sanitized: no $ anywhere on the hub', () => {
    const { container } = render(<CrashHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['eject'] })} />);
    expect(container.textContent ?? '').not.toMatch(/\$/);
  });
});
