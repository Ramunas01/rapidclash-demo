// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KenoHubScreen } from '../screens/KenoHub.js';
import type { KenoView } from '../App.js';

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

type Props = Parameters<typeof KenoHubScreen>[0];
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
function view(mine: number[] = [], over: Partial<KenoView> = {}): KenoView {
  return {
    players: ['alice', 'bob'], round: 0, replays: 0,
    picks: { alice: { picks: mine, locked: false }, bob: { picks: [], locked: false } },
    ...over,
  };
}
const inMatch = (over: Partial<Props> = {}) => baseProps({ currentMatchId: 'm1', gameState: view(), ...over });

describe('KenoHubScreen (GameHub + KenoPanel)', () => {
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
    render(<KenoHubScreen {...baseProps({ onPlay })} />);
    expect(screen.getByTestId('hub-play')).toBeDisabled();
    fireEvent.click(screen.getByTestId('hub-bet-5'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(5);
  });

  it('In-match: the 1..40 board renders and LOCK is disabled until 8 spots are chosen', () => {
    render(<KenoHubScreen {...inMatch()} />);
    expect(screen.getByTestId('hub-board')).toBeInTheDocument();
    expect(screen.getByTestId('spot-1')).toBeInTheDocument();
    expect(screen.getByTestId('spot-40')).toBeInTheDocument();
    expect(screen.getByTestId('lock-btn')).toBeDisabled();
    expect(screen.getByTestId('pick-indicator').textContent).toMatch(/0\/8|Pick 8 more/);
  });

  it('clicking a spot sends a pick move; LOCK enables at 8 picks', () => {
    const onMakeMove = vi.fn();
    render(<KenoHubScreen {...inMatch({ onMakeMove })} />);
    fireEvent.click(screen.getByTestId('spot-7'));
    expect(onMakeMove).toHaveBeenCalledWith({ t: 'pick', n: 7 });
    // A view with 8 picked → LOCK enabled, emits lock.
    onMakeMove.mockClear();
    render(<KenoHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view([1, 2, 3, 4, 5, 6, 7, 8]), onMakeMove })} />);
    const lockBtn = screen.getAllByTestId('lock-btn').at(-1)!;
    expect(lockBtn).not.toBeDisabled();
    fireEvent.click(lockBtn);
    expect(onMakeMove).toHaveBeenCalledWith({ t: 'lock' });
  });

  it('a picked spot toggles back off (unpick)', () => {
    const onMakeMove = vi.fn();
    render(<KenoHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view([7]), onMakeMove })} />);
    fireEvent.click(screen.getByTestId('spot-7'));
    expect(onMakeMove).toHaveBeenCalledWith({ t: 'unpick', n: 7 });
  });

  it("Redaction: the opponent's picks never render; the shared draw shows once resolved", () => {
    const resolved = view([], {
      round: 1,
      lastResult: { round: 0, draw: [3, 7, 11, 15, 19, 23, 27, 31, 35, 39], picks: { alice: [3, 7], bob: [1, 2] }, matched: { alice: 2, bob: 0 } },
    });
    render(<KenoHubScreen {...baseProps({ currentMatchId: 'm1', gameState: resolved })} />);
    const draw = screen.getByTestId('draw-reveal');
    expect(draw.textContent).toMatch(/You matched 2/);
    expect(draw.textContent).toMatch(/Opp 0/);
    // opponent slot pill shows the generic Playing tag, not their picks.
    expect(screen.getByTestId('hub-slot-opponent').textContent).toMatch(/playing/i);
  });

  it('locked: shows the waiting banner instead of the pick board', () => {
    const locked = view([1, 2, 3, 4, 5, 6, 7, 8]);
    locked.picks.alice.locked = true;
    render(<KenoHubScreen {...baseProps({ currentMatchId: 'm1', gameState: locked })} />);
    expect(screen.getByTestId('locked-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('lock-btn')).toBeNull();
  });

  it('is sanitized: no $ anywhere on the hub', () => {
    const { container } = render(<KenoHubScreen {...inMatch()} />);
    expect(container.textContent ?? '').not.toMatch(/\$/);
  });
});
