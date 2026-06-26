// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiceHubScreen } from '../screens/DiceHub.js';
import type { DiceView } from '../App.js';

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));
type Props = Parameters<typeof DiceHubScreen>[0];

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
const preRoll = (): DiceView => ({ players: ['me', 'opp'], seeds: {}, round: 0, replays: 0, revealed: {} });
const resolved = (): DiceView => ({
  players: ['me', 'opp'], seeds: { me: 1, opp: 2 }, round: 0, replays: 0, revealed: { me: true, opp: true },
  result: { rolls: { me: 5000, opp: 3000 }, round: 0 }, winner: 'me',
});

describe('DiceHubScreen', () => {
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
    render(<DiceHubScreen {...baseProps({ onPlay })} />);
    fireEvent.click(screen.getByTestId('hub-bet-10'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(10);
  });

  it('In-match: auto-commits the reveal (no decisions) and hides both rolls until resolved', () => {
    const onMakeMove = vi.fn();
    render(<DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState: preRoll(), legalMoves: ['reveal'], onMakeMove })} />);
    expect(onMakeMove).toHaveBeenCalledWith('reveal'); // auto-fired
    expect(screen.getByTestId('dice-status').textContent).toMatch(/rolling/i);
  });

  it('Resolved: reveals both rolls and the winner', () => {
    render(<DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState: resolved() })} />);
    expect(screen.getByTestId('hub-board').textContent).toContain('50.00'); // my roll
    expect(screen.getByTestId('hub-board').textContent).toContain('30.00'); // opponent
    expect(screen.getByTestId('dice-status').textContent).toMatch(/you rolled higher/i);
  });

  it('is sanitized: no $ anywhere on the hub', () => {
    const { container } = render(<DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState: resolved() })} />);
    expect(container.textContent ?? '').not.toMatch(/\$/);
  });
});
