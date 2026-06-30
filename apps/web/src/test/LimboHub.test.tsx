// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LimboHubScreen } from '../screens/LimboHub.js';
import type { LimboView } from '../App.js';

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

type Props = Parameters<typeof LimboHubScreen>[0];
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
function view(target: number | null = null, over: Partial<LimboView> = {}): LimboView {
  return {
    players: ['alice', 'bob'], round: 0, replays: 0,
    picks: { alice: { target, locked: false }, bob: { target: null, locked: false } },
    ...over,
  };
}
const inMatch = (over: Partial<Props> = {}) => baseProps({ currentMatchId: 'm1', gameState: view(), ...over });

describe('LimboHubScreen (GameHub + LimboPanel)', () => {
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
    render(<LimboHubScreen {...baseProps({ onPlay })} />);
    fireEvent.click(screen.getByTestId('hub-bet-5'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(5);
  });

  it('#143: PLAY with no bet armed guides to the bet panel (no match starts); arming clears the cue, no auto-play', () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const onPlay = vi.fn();
    render(<LimboHubScreen {...baseProps({ onPlay })} />);

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

  it('In-match: the target ladder renders and LOCK is disabled until a target is chosen', () => {
    render(<LimboHubScreen {...inMatch()} />);
    expect(screen.getByTestId('hub-board')).toBeInTheDocument();
    expect(screen.getByTestId('target-2')).toBeInTheDocument();
    expect(screen.getByTestId('target-1000000')).toBeInTheDocument();
    expect(screen.getByTestId('lock-btn')).toBeDisabled();
  });

  it('picking a target sends a pick move; LOCK enables once chosen', () => {
    const onMakeMove = vi.fn();
    render(<LimboHubScreen {...inMatch({ onMakeMove })} />);
    fireEvent.click(screen.getByTestId('target-5'));
    expect(onMakeMove).toHaveBeenCalledWith({ t: 'pick', target: 5 });
    // a view with a chosen target → LOCK enabled
    onMakeMove.mockClear();
    render(<LimboHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view(5), onMakeMove })} />);
    const lock = screen.getAllByTestId('lock-btn').at(-1)!;
    expect(lock).not.toBeDisabled();
    fireEvent.click(lock);
    expect(onMakeMove).toHaveBeenCalledWith({ t: 'lock' });
  });

  it("Redaction: the opponent's target is never rendered; the roll shows once resolved", () => {
    const resolved = view(null, {
      round: 1,
      lastResult: { round: 0, roll: 2.47, targets: { alice: 2, bob: 5 }, winner: 'alice' },
    });
    render(<LimboHubScreen {...baseProps({ currentMatchId: 'm1', gameState: resolved })} />);
    expect(screen.getByTestId('roll-value').textContent).toMatch(/2\.47/);
    expect(screen.getByTestId('hub-slot-opponent').textContent).toMatch(/playing/i);
  });

  it('locked: shows the waiting banner with the locked target', () => {
    const locked = view(10);
    locked.picks.alice.locked = true;
    render(<LimboHubScreen {...baseProps({ currentMatchId: 'm1', gameState: locked })} />);
    expect(screen.getByTestId('locked-banner').textContent).toMatch(/10×/);
    expect(screen.queryByTestId('lock-btn')).toBeNull();
  });

  it('is sanitized: no $ anywhere on the hub', () => {
    const { container } = render(<LimboHubScreen {...inMatch()} />);
    expect(container.textContent ?? '').not.toMatch(/\$/);
  });
});
