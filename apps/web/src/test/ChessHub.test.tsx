// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
      { id: 'rapid10', label: 'Default · 10 min', baseMs: 600_000, incrementMs: 0 },
      { id: 'blitz5', label: 'Blitz · 5 min', baseMs: 300_000, incrementMs: 0 },
      { id: 'bullet1', label: 'Bullet · 1 min', baseMs: 60_000, incrementMs: 0 },
    ],
    defaultId: 'rapid10',
  },
};

type Props = Parameters<typeof ChessHubScreen>[0];
function baseProps(over: Partial<Props> = {}): Props {
  return {
    token: 'tok', playerId: 'alice', username: 'alice', opponentId: 'bob', balance: 1000,
    currentMatchId: null, gameState: null, legalMoves: [], waitingExpiresAt: null, lobbyExpired: false,
    lastOutcome: null, lastSettlement: null, challenges: [], challengeNotice: null,
    onPlay: vi.fn(), onCancel: vi.fn(), onRepost: vi.fn(), onTakeChallenge: vi.fn(),
    onMakeMove: vi.fn(), onForfeit: vi.fn(), onSubscribe: vi.fn(), onUnsubscribe: vi.fn(),
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
    expect(screen.getByTestId('turn-indicator').textContent).toBe('Your move');

    fireEvent.click(sq(container, 'e2')); // select the pawn
    fireEvent.click(sq(container, 'e4')); // push it (a server-issued legal target)
    expect(onMakeMove).toHaveBeenCalledWith({ from: 'e2', to: 'e4' });

    onMakeMove.mockClear();
    fireEvent.click(sq(container, 'e2'));
    fireEvent.click(sq(container, 'e5')); // not in legalMoves → never sent
    expect(onMakeMove).not.toHaveBeenCalled();
  });

  it('In-match: renders both clocks; the active side is flagged and shows a low-time warning under 10s', () => {
    const clock: PlayerClocks = {
      remainingMs: { alice: 300_000, bob: 8_000 }, active: 'bob', activeSince: Date.now(), timeControlId: 'blitz5',
    };
    render(<ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ clock }), legalMoves: asLegal([]) })} />);

    const self = screen.getByTestId('chess-clock-self');
    const opp = screen.getByTestId('chess-clock-opponent');
    expect(self.textContent).toContain('5:00'); // alice, paused at full
    expect(self.getAttribute('data-active')).toBe('false');
    // bob is on the move with <10s left → active + low-time.
    expect(opp.getAttribute('data-active')).toBe('true');
    expect(opp.getAttribute('data-low-time')).toBe('true');
  });

  it('not-your-turn hides the move affordance (no legalMoves → opponent to move)', () => {
    render(<ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({}), legalMoves: asLegal([]) })} />);
    expect(screen.getByTestId('turn-indicator').textContent).toBe("Opponent's move");
  });

  it('Feed: a chess open-challenge row shows its time-control label', async () => {
    const challenge = {
      matchId: 'c1', ownerName: 'rival', stake: 10, openedAt: 0, expiresAt: Date.now() + 30_000, timeControlId: 'blitz5',
    };
    render(<ChessHubScreen {...baseProps({ challenges: [challenge] })} />);
    // The control label resolves once /games (meta.timeControl) loads.
    await waitFor(() => expect(screen.getByTestId('hub-control-c1').textContent).toContain('Blitz · 5 min'));
    expect(screen.getByTestId('hub-stake-c1').textContent).toBe('10¢');
  });
});
