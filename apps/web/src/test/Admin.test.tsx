// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AdminScreen } from '../screens/Admin.js';
import type { AdminPlayerSummary, AdminPlayerLogResponse } from '@rapidclash/shared';

const PLAYER_A: AdminPlayerSummary = {
  playerId: 'p1', displayName: 'alice', source: 'investor-link', balance: 1000,
  gamesPlayed: 5, wins: 3, losses: 2, draws: 0, moneyWon: 150, moneyLost: 80,
};
const PLAYER_B: AdminPlayerSummary = {
  playerId: 'p2', displayName: 'bob', source: null, balance: 500,
  gamesPlayed: 0, wins: 0, losses: 0, draws: 0, moneyWon: 0, moneyLost: 0,
};

function stubFetch(players: AdminPlayerSummary[], log?: AdminPlayerLogResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/admin/players/') && u.endsWith('/log')) {
        return { ok: true, json: async () => log ?? { matches: [], ledgerEntries: [] } } as Response;
      }
      if (u.includes('/admin/players')) {
        return { ok: true, json: async () => players } as Response;
      }
      return { ok: false, json: async () => ({ error: 'unexpected' }) } as Response;
    }),
  );
}

describe('AdminScreen (ticket 2026-10-01#7)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders every account by default, including both source-tagged and direct-traffic ones', async () => {
    stubFetch([PLAYER_A, PLAYER_B]);
    render(<AdminScreen token="tok" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('admin-players-table')).toBeInTheDocument());
    expect(screen.getByTestId('admin-player-p1')).toBeInTheDocument();
    expect(screen.getByTestId('admin-player-p2')).toBeInTheDocument();
  });

  it('the "Demo-link only" filter toggle hides accounts with no source', async () => {
    stubFetch([PLAYER_A, PLAYER_B]);
    render(<AdminScreen token="tok" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('admin-players-table')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('admin-source-filter'));
    expect(screen.getByTestId('admin-player-p1')).toBeInTheDocument(); // tagged — stays
    expect(screen.queryByTestId('admin-player-p2')).toBeNull(); // untagged — hidden

    fireEvent.click(screen.getByTestId('admin-source-filter')); // toggle back off
    expect(screen.getByTestId('admin-player-p2')).toBeInTheDocument();
  });

  it('shows each account\'s real balance and game stats in the list row', async () => {
    stubFetch([PLAYER_A]);
    render(<AdminScreen token="tok" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('admin-players-table')).toBeInTheDocument());
    const row = screen.getByTestId('admin-player-p1');
    expect(within(row).getByText('$1,000')).toBeInTheDocument();
    expect(within(row).getByText('3/2/0')).toBeInTheDocument(); // W/L/D
  });

  it('tapping a row opens that account\'s detail log view, fetched on demand', async () => {
    const log: AdminPlayerLogResponse = {
      matches: [{ matchId: 'm1', gameId: 'rps', opponent: 'bob', result: 'win', amount: 90, runningBalance: 1090, createdAt: '2026-10-01T00:00:00.000Z' }],
      ledgerEntries: [{ id: 'e1', type: 'GRANT', amount: 1000, currency: 'USD', idempotencyKey: 'grant:p1', createdAt: '2026-09-01T00:00:00.000Z' }],
    };
    stubFetch([PLAYER_A], log);
    render(<AdminScreen token="tok" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('admin-players-table')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('admin-player-p1'));
    await waitFor(() => expect(screen.getByTestId('admin-log-title')).toHaveTextContent('alice'));
    expect(screen.getByTestId('admin-match-m1')).toBeInTheDocument();
    expect(screen.getByTestId('admin-ledger-e1')).toBeInTheDocument();
  });

  it('a player with no matches shows the empty-state message, not an empty table', async () => {
    stubFetch([PLAYER_B], { matches: [], ledgerEntries: [] });
    render(<AdminScreen token="tok" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('admin-players-table')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('admin-player-p2'));
    await waitFor(() => expect(screen.getByTestId('admin-log-no-matches')).toBeInTheDocument());
  });

  it('the back button inside the detail view returns to the list, not out of the screen', async () => {
    stubFetch([PLAYER_A], { matches: [], ledgerEntries: [] });
    render(<AdminScreen token="tok" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('admin-players-table')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('admin-player-p1'));
    await waitFor(() => expect(screen.getByTestId('admin-log-title')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('admin-log-back'));
    expect(screen.getByTestId('admin-players-table')).toBeInTheDocument();
  });

  it('the top-level back button calls onBack (never swallowed by the detail view)', async () => {
    const onBack = vi.fn();
    stubFetch([PLAYER_A]);
    render(<AdminScreen token="tok" onBack={onBack} />);
    await waitFor(() => expect(screen.getByTestId('admin-players-table')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('admin-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('surfaces a fetch error instead of silently showing an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    render(<AdminScreen token="tok" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('admin-error')).toHaveTextContent('network down'));
  });
});
