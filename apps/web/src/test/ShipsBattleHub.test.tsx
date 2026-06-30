// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShipsBattleHubScreen } from '../screens/ShipsBattleHub.js';
import type { ShipsBattleView, ShipsBoardView } from '../App.js';

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

type Props = Parameters<typeof ShipsBattleHubScreen>[0];

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
const freshBoard = (over: Partial<ShipsBoardView> = {}): ShipsBoardView => ({ ships: [], current: [], placementDone: false, shots: {}, sunk: [], ...over });
const placementView = (over: Partial<ShipsBattleView> = {}): ShipsBattleView => ({
  players: ['me', 'opp'], phase: 'placement', placementStartedAt: Date.now(), turn: null, turnStartedAt: 0,
  boards: { me: freshBoard(), opp: freshBoard() }, ...over,
});
const shootingView = (over: Partial<ShipsBattleView> = {}): ShipsBattleView => ({
  players: ['me', 'opp'], phase: 'shooting', placementStartedAt: 0, turn: 'me', turnStartedAt: Date.now(),
  boards: {
    me: freshBoard({ ships: [[0, 1]], placementDone: true }),
    opp: freshBoard({ placementDone: true, shots: { 5: 'miss' } }),
  },
  ...over,
});

describe('ShipsBattleHubScreen (GameHub + ShipsBattlePanel)', () => {
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
    render(<ShipsBattleHubScreen {...baseProps({ onPlay })} />);
    fireEvent.click(screen.getByTestId('hub-bet-10'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(10);
  });

  it('#143: PLAY with no bet armed guides to the bet panel (no match starts); arming clears the cue, no auto-play', () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const onPlay = vi.fn();
    render(<ShipsBattleHubScreen {...baseProps({ onPlay })} />);

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

  it('PLACEMENT: an empty board offers every cell as eligible; tapping one sends an `add`', () => {
    const onMakeMove = vi.fn();
    render(<ShipsBattleHubScreen {...baseProps({ currentMatchId: 'm1', gameState: placementView(), onMakeMove })} />);
    expect(screen.getByTestId('sb-cell-0')).toBeEnabled();
    fireEvent.click(screen.getByTestId('sb-cell-0'));
    expect(onMakeMove).toHaveBeenCalledWith({ t: 'add', c: 0 });
  });

  it('PLACEMENT: a locked ship blocks its halo; the Auto-place button sends `auto`', () => {
    const onMakeMove = vi.fn();
    // One locked ship at cells 0,1 → cell 11 (its diagonal halo) is blocked (disabled).
    const view = placementView({ boards: { me: freshBoard({ ships: [[0, 1]] }), opp: freshBoard() } });
    render(<ShipsBattleHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view, onMakeMove })} />);
    expect(screen.getByTestId('sb-cell-11')).toBeDisabled(); // halo of the locked ship
    expect(screen.getByTestId('sb-cell-0')).toBeDisabled(); // already a ship cell
    fireEvent.click(screen.getByTestId('sb-auto'));
    expect(onMakeMove).toHaveBeenCalledWith({ t: 'auto' });
  });

  it('PLACEMENT done: shows "Fleet ready" and waits for the opponent', () => {
    const view = placementView({ boards: { me: freshBoard({ placementDone: true }), opp: freshBoard() } });
    render(<ShipsBattleHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view })} />);
    expect(screen.getByTestId('sb-ready').textContent).toMatch(/fleet ready/i);
  });

  it('SHOOTING: on my turn an un-probed enemy cell fires; a probed one is inert', () => {
    const onMakeMove = vi.fn();
    render(<ShipsBattleHubScreen {...baseProps({ currentMatchId: 'm1', gameState: shootingView(), onMakeMove })} />);
    expect(screen.getByTestId('sb-turn').textContent).toMatch(/your shot/i);
    expect(screen.getByTestId('sb-probe-5')).toBeDisabled(); // already a miss
    fireEvent.click(screen.getByTestId('sb-probe-12'));
    expect(onMakeMove).toHaveBeenCalledWith({ t: 'fire', c: 12 });
  });

  it("SHOOTING: not my turn → the probe grid is inert", () => {
    render(<ShipsBattleHubScreen {...baseProps({ currentMatchId: 'm1', gameState: shootingView({ turn: 'opp' }) })} />);
    expect(screen.getByTestId('sb-turn').textContent).toMatch(/opponent/i);
    expect(screen.getByTestId('sb-probe-12')).toBeDisabled();
  });

  it('is sanitized: no $ anywhere on the hub', () => {
    const { container } = render(<ShipsBattleHubScreen {...baseProps({ currentMatchId: 'm1', gameState: shootingView() })} />);
    expect(container.textContent ?? '').not.toMatch(/\$/);
  });
});
