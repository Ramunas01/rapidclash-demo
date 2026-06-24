// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ChessHubScreen } from '../screens/ChessHub.js';
import type { ChessView, ChessMove, GameView } from '../App.js';
import type { PlayerClocks, GameMeta } from '@rapidclash/shared';

// canvas-confetti needs a real <canvas> (absent in jsdom) — mock it (matches the other hub tests).
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** The chess meta the picker is data-driven from (mirrors the module's declared timeControl). */
const CHESS_META: GameMeta = {
  id: 'chess', displayName: 'Chess', minPlayers: 2, maxPlayers: 2,
  ranking: { kind: 'elo', k: 32 }, bet: { minStake: 1, maxStake: 100, symmetricStake: true },
  averageDurationSec: 300, rakeRate: 0.1,
  timeControl: {
    options: [
      { id: 'bullet1', label: 'Bullet · 1 min', baseMs: 60_000, incrementMs: 0 },
      { id: 'blitz5', label: 'Blitz · 5 min', baseMs: 300_000, incrementMs: 0 },
      { id: 'rapid10', label: 'Rapid · 10 min', baseMs: 600_000, incrementMs: 0 },
    ],
    defaultId: 'rapid10',
  },
};

type Props = Parameters<typeof ChessHubScreen>[0];
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

const view = (partial: Partial<ChessView>): GameView => ({ players: ['alice', 'bob'], fen: START_FEN, ...partial } as GameView);
const OPENING: ChessMove[] = [{ from: 'e2', to: 'e4' }, { from: 'e2', to: 'e3' }, { from: 'd2', to: 'd4' }];
const asLegal = (m: ChessMove[]) => m as unknown as string[];
const sq = (c: HTMLElement, s: string): HTMLElement => {
  const el = c.querySelector(`[data-square="${s}"]`);
  if (!el) throw new Error(`square ${s} not rendered`);
  return el as HTMLElement;
};

describe('ChessHubScreen (GameHub + ChessPanel)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games')) return { ok: true, json: async () => [CHESS_META] } as Response;
      if (u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Idle: the time-control picker (data-driven from meta.timeControl) drives PLAY → onPlay(stake, control)', async () => {
    const onPlay = vi.fn();
    render(<ChessHubScreen {...baseProps({ onPlay })} />);
    // The picker appears once /games resolves; default control is preselected.
    await screen.findByTestId('hub-tc-rapid10');
    expect(screen.getByTestId('hub-tc-blitz5')).toBeInTheDocument();
    expect(screen.getByTestId('hub-tc-bullet1')).toBeInTheDocument();

    // Default control → PLAY posts at rapid10.
    fireEvent.click(screen.getByTestId('hub-bet-10'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenLastCalledWith(10, 'rapid10');

    // Pick Blitz → PLAY posts at blitz5.
    fireEvent.click(screen.getByTestId('hub-tc-blitz5'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenLastCalledWith(10, 'blitz5');
  });

  it('In-match: the board activates and a legal click sends the {from,to} move; an illegal target does not', () => {
    const onMakeMove = vi.fn();
    const { container } = render(
      <ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({}), legalMoves: asLegal(OPENING), onMakeMove })} />,
    );
    expect(screen.getByTestId('chess-board')).toBeInTheDocument();

    fireEvent.click(sq(container, 'e2')); // select the pawn
    fireEvent.click(sq(container, 'e4')); // push it (a server-issued legal target)
    expect(onMakeMove).toHaveBeenCalledWith({ from: 'e2', to: 'e4' });

    onMakeMove.mockClear();
    fireEvent.click(sq(container, 'e2'));
    fireEvent.click(sq(container, 'e5')); // not in legalMoves → never sent
    expect(onMakeMove).not.toHaveBeenCalled();
  });

  it('Picker: each option is a two-line button — large duration over small mode name', async () => {
    render(<ChessHubScreen {...baseProps()} />);
    const rapid = await screen.findByTestId('hub-tc-rapid10');
    expect(rapid.textContent).toContain('10 min');
    expect(rapid.textContent).toContain('Rapid');
    expect(screen.getByTestId('hub-tc-bullet1').textContent).toContain('1 min');
    expect(screen.getByTestId('hub-tc-bullet1').textContent).toContain('Bullet');
    // Default control (rapid10) is pre-selected.
    expect(rapid.getAttribute('aria-pressed')).toBe('true');
  });

  it('In-match: the clocks live INSIDE the slot pills (opponent above, you below)', () => {
    const clock: PlayerClocks = {
      remainingMs: { alice: 300_000, bob: 8_000 }, active: 'bob', activeSince: Date.now(), timeControlId: 'blitz5',
    };
    render(<ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ clock }), legalMoves: asLegal([]) })} />);

    // Migrated into the pills — not a separate grey clock table above the board.
    const ownPill = within(screen.getByTestId('hub-slot-own'));
    const oppPill = within(screen.getByTestId('hub-slot-opponent'));
    const self = ownPill.getByTestId('chess-clock-self');
    const opp = oppPill.getByTestId('chess-clock-opponent');
    expect(self.textContent).toContain('5:00'); // alice, paused at full
    expect(self.getAttribute('data-active')).toBe('false');
    // bob is on the move with <10s left → active + low-time.
    expect(opp.getAttribute('data-active')).toBe('true');
    expect(opp.getAttribute('data-low-time')).toBe('true');
  });

  it('Pre-game: the board is empty (no pieces) and carries no instructional text', async () => {
    const { container } = render(<ChessHubScreen {...baseProps()} />);
    await screen.findByTestId('hub-tc-rapid10'); // wait for /games
    // No pieces and no on-board helper copy before the match starts.
    expect(container.querySelector('[data-piece]')).toBeNull();
    expect(container.textContent ?? '').not.toMatch(/tap a piece/i);
    expect(container.textContent ?? '').not.toMatch(/pick a bet/i);
    expect(container.textContent ?? '').not.toMatch(/waiting for an opponent…/i);
  });

  it('not-your-turn: no legalMoves → a click never produces a move (pieces inert)', () => {
    const onMakeMove = vi.fn();
    const { container } = render(
      <ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({}), legalMoves: asLegal([]), onMakeMove })} />,
    );
    // The board still renders, but with no server-issued legalMoves a click sends nothing.
    expect(screen.getByTestId('chess-board')).toBeInTheDocument();
    fireEvent.click(sq(container, 'e2'));
    fireEvent.click(sq(container, 'e4'));
    expect(onMakeMove).not.toHaveBeenCalled();
  });

  it('Feed: a chess open-challenge shows in the cross-game Open Games ticker (game + ¢ stake)', async () => {
    const challenge = {
      matchId: 'c1', ownerName: 'rival', stake: 10, openedAt: 0, expiresAt: Date.now() + 30_000, timeControlId: 'blitz5',
    };
    render(<ChessHubScreen {...baseProps({ challengesByGame: { chess: [challenge] } })} />);
    // The revised hub uses the Home page's cross-game ticker (no per-row time-control chip).
    await waitFor(() => expect(screen.getByTestId('home-row-c1')).toBeInTheDocument());
    expect(screen.getByTestId('home-stake-c1').textContent).toBe('10¢');
    expect(screen.getByTestId('home-row-game-c1').textContent).toBe('Chess');
  });
});
