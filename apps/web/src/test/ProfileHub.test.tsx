// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ProfileHubScreen } from '../screens/ProfileHub.js';
import type { GameMeta, LedgerEntry, LeaderboardEntry } from '@rapidclash/shared';

type Props = Parameters<typeof ProfileHubScreen>[0];

const META = (id: string, displayName: string): GameMeta => ({
  id, displayName, minPlayers: 2, maxPlayers: 2,
  ranking: { kind: 'net_winnings' }, bet: { minStake: 1, maxStake: 100, symmetricStake: true },
  averageDurationSec: 10, rakeRate: 0.025,
});
const GAMES: GameMeta[] = [META('coinflip', 'Coinflip'), META('chess', 'Chess')];

const LEDGER: LedgerEntry[] = [
  { id: 'e1', type: 'GRANT', amount: 1000, idempotencyKey: 'k1', createdAt: '2026-06-20T10:00:00Z' },
  { id: 'e2', type: 'BET_ESCROW', amount: -10, idempotencyKey: 'k2', createdAt: '2026-06-20T11:00:00Z' },
  { id: 'e3', type: 'SETTLE_WIN', amount: 19, matchId: 'm1', idempotencyKey: 'k3', createdAt: '2026-06-20T11:01:00Z' },
];

const CF_BOARD: LeaderboardEntry[] = [
  { rank: 1, playerId: 'p1', displayName: 'alice', score: 90, kind: 'net_winnings', netWinnings: 90 },
  { rank: 2, playerId: 'p2', displayName: 'bob', score: -10, kind: 'net_winnings', netWinnings: -10 },
];
const CHESS_BOARD: LeaderboardEntry[] = [
  { rank: 1, playerId: 'p3', displayName: 'carol', score: 1516, kind: 'elo', rating: 1516 },
];

function baseProps(over: Partial<Props> = {}): Props {
  return {
    token: 'tok',
    username: 'alice',
    balance: 1009,
    onLogout: vi.fn(),
    onHome: vi.fn(),
    onOpenProfile: vi.fn(),
    ...over,
  };
}

describe('ProfileHubScreen', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games')) return { ok: true, json: async () => GAMES } as Response;
      if (u.includes('/leaderboard/chess')) return { ok: true, json: async () => CHESS_BOARD } as Response;
      if (u.includes('/leaderboard/coinflip')) return { ok: true, json: async () => CF_BOARD } as Response;
      if (u.includes('/wallet')) return { ok: true, json: async () => ({ balance: 1009, entries: LEDGER }) } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the profile header (alias + log out)', () => {
    const onLogout = vi.fn();
    render(<ProfileHubScreen {...baseProps({ onLogout })} />);
    expect(screen.getByTestId('profile-username').textContent).toBe('alice');
    fireEvent.click(screen.getByTestId('profile-logout'));
    expect(onLogout).toHaveBeenCalled();
  });

  it('shows the wallet balance in ¢ and the recent ledger entries (signed amounts)', async () => {
    render(<ProfileHubScreen {...baseProps()} />);
    // Balance refreshed from /wallet, rendered in ¢.
    await waitFor(() => expect(screen.getByTestId('profile-balance').textContent).toBe('1,009¢'));
    const ledger = within(screen.getByTestId('profile-ledger'));
    expect(ledger.getByTestId('profile-entry-e1').textContent).toMatch(/GRANT/);
    expect(ledger.getByTestId('profile-entry-e1').textContent).toContain('+1,000¢');
    expect(ledger.getByTestId('profile-entry-e2').textContent).toContain('-10¢'); // BET_ESCROW debit
    expect(ledger.getByTestId('profile-entry-e3').textContent).toContain('+19¢'); // SETTLE_WIN credit
  });

  it('renders the leaderboard and switches game via the picker (kind-aware)', async () => {
    render(<ProfileHubScreen {...baseProps()} />);
    // Default coinflip (net_winnings, ¢, can be negative).
    await waitFor(() => expect(screen.getByTestId('profile-rank-p1')).toBeInTheDocument());
    const board = within(screen.getByTestId('profile-leaderboard'));
    expect(board.getByTestId('profile-rank-p1').textContent).toContain('+90¢');
    expect(board.getByTestId('profile-rank-p2').textContent).toContain('-10¢');

    // Pick chess → elo rendering.
    fireEvent.click(board.getByTestId('profile-lb-pick-chess'));
    await waitFor(() => expect(screen.getByTestId('profile-rank-p3')).toBeInTheDocument());
    expect(screen.getByTestId('profile-rank-p3').textContent).toContain('1516 ELO');
  });

  it('is sanitized: no $ anywhere on the hub', async () => {
    const { container } = render(<ProfileHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('profile-balance').textContent).toBe('1,009¢'));
    await waitFor(() => expect(screen.getByTestId('profile-rank-p1')).toBeInTheDocument());
    expect(container.textContent ?? '').not.toMatch(/\$/);
  });
});
