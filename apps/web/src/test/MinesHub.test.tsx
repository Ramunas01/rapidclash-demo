// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MinesHubScreen } from '../screens/MinesHub.js';
import type { MinesView, MinesBoardView } from '../App.js';

// canvas-confetti needs a real <canvas> (absent in jsdom) — mock it (matches the other hub tests).
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

type Props = Parameters<typeof MinesHubScreen>[0];

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

const allCovered = Array.from({ length: 64 }, (_, i) => i);
const kind = (i: number) => screen.getByTestId(`cell-${i}`).getAttribute('data-kind');

function view(me: Partial<MinesBoardView>, opp: Partial<MinesBoardView> = {}, extra: Partial<MinesView> = {}): MinesView {
  return {
    players: ['alice', 'bob'],
    round: 0,
    draws: 0,
    boards: { alice: { locked: false, ...me }, bob: { locked: false, ...opp } },
    ...extra,
  };
}

// In-match the App feeds the hub the mines square indices as legalMoves (typed string[] at the
// generic slot boundary, number-valued at runtime for Mines) — mirror that here.
const asLegal = (idxs: number[]) => idxs as unknown as string[];

describe('MinesHubScreen (GameHub + MinesPanel)', () => {
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
    render(<MinesHubScreen {...baseProps({ onPlay })} />);
    expect(screen.getByTestId('hub-play')).toBeDisabled();
    fireEvent.click(screen.getByTestId('hub-bet-25'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(25);
  });

  it('In-match: the 8×8 board activates, and clicks are gated to server legalMoves → onMove(index)', () => {
    const onMakeMove = vi.fn();
    // Server says only square 5 is covered+legal right now.
    render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ uncovered: [] }), legalMoves: asLegal([5]), onMakeMove })} />);
    expect(screen.getByTestId('mines-board')).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')).toHaveLength(64);

    expect(screen.getByTestId('cell-5')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('cell-5'));
    expect(onMakeMove).toHaveBeenCalledWith(5);

    // A covered square NOT in legalMoves is disabled and never fires.
    onMakeMove.mockClear();
    expect(screen.getByTestId('cell-6')).toBeDisabled();
    fireEvent.click(screen.getByTestId('cell-6'));
    expect(onMakeMove).not.toHaveBeenCalled();
  });

  it('In-match: renders own safe / busted / mine cells once locked', () => {
    render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ uncovered: [0, 1], locked: true, bustedOn: 10, mines: [10, 20, 30] }), legalMoves: asLegal([]) })} />);
    expect(kind(0)).toBe('safe');
    expect(kind(10)).toBe('bustedOn'); // the detonated mine wins over plain 'mine'
    expect(kind(20)).toBe('mine');     // layout revealed once locked
    expect(kind(2)).toBe('covered');
    expect(screen.getByTestId('my-status').textContent).toBe('Busted');
  });

  it('Redaction: hides the opponent count while both are active and never renders an opponent board', () => {
    render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ uncovered: [1] }, { locked: false }), legalMoves: asLegal(allCovered) })} />);
    const oppCount = screen.getByTestId('opponent-count');
    expect(oppCount.textContent).not.toMatch(/\d+ safe/); // no number leaked
    expect(oppCount.querySelector('[aria-label="hidden"]')).toBeInTheDocument();
    // Only the player's own 64 cells exist — the opponent's board is never in the DOM.
    expect(screen.getAllByRole('gridcell')).toHaveLength(64);
  });

  it('Chase: reveals the opponent count once it is provided (server-gated on lock)', () => {
    render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ uncovered: [2] }, { locked: true, score: 7 }), legalMoves: asLegal(allCovered) })} />);
    expect(screen.getByTestId('opponent-count').textContent).toContain('7 safe');
  });

  it('Replay: an internal draw-replay re-deals — the board resets for the new round, no result overlay', () => {
    const { rerender } = render(
      <MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ uncovered: [0, 1, 2] }), legalMoves: asLegal([3, 4, 5]) })} />,
    );
    expect(kind(0)).toBe('safe');
    expect(screen.queryByTestId('round-indicator')).not.toBeInTheDocument();

    // Draw → replay within the SAME match (currentMatchId stays set): round bumps, board resets,
    // and crucially no result overlay is shown (the match keeps going).
    rerender(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ uncovered: [] }, {}, { round: 1 }), legalMoves: asLegal(allCovered) })} />);
    expect(kind(0)).toBe('covered'); // the previously-safe square is covered again
    expect(screen.getByTestId('cell-0')).not.toBeDisabled();
    expect(screen.getByTestId('round-indicator').textContent).toContain('Round 2');
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull();
  });

  it('Result: only the decisive match.end surfaces the GameHub overlay with the ¢ delta', async () => {
    const gameState = view({ uncovered: [0, 1, 2, 3], locked: true });
    const { rerender } = render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: asLegal([]) })} />);
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull();

    rerender(<MinesHubScreen {...baseProps({ currentMatchId: null, gameState, lastOutcome: { type: 'win', winner: 'alice' }, lastSettlement: { delta: 18, newBalance: 1018 } })} />);
    await waitFor(() => expect(screen.getByTestId('hub-result-overlay')).toBeInTheDocument());
    expect(screen.getByTestId('hub-result-text').textContent).toContain('You Won');
    expect(screen.getByTestId('hub-result-delta').textContent).toBe('+18¢');
  });
});
