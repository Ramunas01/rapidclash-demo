// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AdminScreen } from '../screens/Admin.js';
import type { AdminPlayerSummary, AdminPlayerLogResponse } from '@rapidclash/shared';

const PLAYER_A: AdminPlayerSummary = {
  playerId: 'p1', displayName: 'alice', source: 'investor-link', balance: 1000,
  gamesPlayed: 5, wins: 3, losses: 2, draws: 0, moneyWon: 150, moneyLost: 80,
  lastSeenAt: '2026-10-01T12:00:00.000Z',
};
const PLAYER_B: AdminPlayerSummary = {
  playerId: 'p2', displayName: 'bob', source: null, balance: 500,
  gamesPlayed: 0, wins: 0, losses: 0, draws: 0, moneyWon: 0, moneyLost: 0,
  lastSeenAt: null,
};
// Ticket 2026-10-01#10, item 1: a bot account — same 🤖-prefix signal as everywhere else in this
// codebase (match-history.ts's avatarFor, gateway.ts's resolveAvatarId), no separate schema flag.
const PLAYER_BOT: AdminPlayerSummary = {
  playerId: 'p3', displayName: '🤖@knightfall', source: null, balance: 904,
  gamesPlayed: 12, wins: 6, losses: 6, draws: 0, moneyWon: 300, moneyLost: 300,
  lastSeenAt: '2026-10-01T11:00:00.000Z',
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
      matches: [{ matchId: 'm1', gameId: 'rps', opponent: 'bob', result: 'win', amount: 90, runningBalance: 1090, currency: 'USD', createdAt: '2026-10-01T00:00:00.000Z' }],
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

// Ticket 2026-10-01#10 (D75) — Owner's first hands-on use of the admin screen surfaced 4 items.
// Item 4 (the priority — covered in match-history.test.ts/admin.test.ts) was a real bug: the
// detail log was silently USD-only, dropping every match a SOL-default player ever settled.
// These cover the other 3, plus this screen's own currency-labeling fix for item 4.
describe('AdminScreen — hide-bots, last-seen, time-range (ticket 2026-10-01#10)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('the "Hide bots" filter toggle hides 🤖-prefixed accounts', async () => {
    stubFetch([PLAYER_A, PLAYER_BOT]);
    render(<AdminScreen token="tok" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('admin-players-table')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('admin-hide-bots-filter'));
    expect(screen.getByTestId('admin-player-p1')).toBeInTheDocument(); // human — stays
    expect(screen.queryByTestId('admin-player-p3')).toBeNull(); // bot — hidden

    fireEvent.click(screen.getByTestId('admin-hide-bots-filter')); // toggle back off
    expect(screen.getByTestId('admin-player-p3')).toBeInTheDocument();
  });

  it('"Demo-link only" and "Hide bots" compose with AND, not OR', async () => {
    // A source-tagged bot: with both filters on, it must be hidden (fails the bot check), not
    // shown (which an OR composition would incorrectly do, since it passes the source check).
    const taggedBot: AdminPlayerSummary = { ...PLAYER_BOT, source: 'investor-link' };
    stubFetch([PLAYER_A, taggedBot]);
    render(<AdminScreen token="tok" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('admin-players-table')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('admin-source-filter'));
    fireEvent.click(screen.getByTestId('admin-hide-bots-filter'));
    expect(screen.getByTestId('admin-player-p1')).toBeInTheDocument(); // human + tagged — stays
    expect(screen.queryByTestId('admin-player-p3')).toBeNull(); // bot + tagged — AND fails on bot
  });

  it('renders a "Last seen" column, formatted, with an em-dash for an account with no activity', async () => {
    stubFetch([PLAYER_A, PLAYER_B]);
    render(<AdminScreen token="tok" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('admin-players-table')).toBeInTheDocument());

    const rowA = screen.getByTestId('admin-lastseen-p1');
    expect(rowA.textContent).toBe(new Date(PLAYER_A.lastSeenAt!).toLocaleString());
    expect(screen.getByTestId('admin-lastseen-p2').textContent).toBe('—');
  });

  it('the time-range filter hides accounts last seen outside the selected window', async () => {
    // Real relative timestamps (not vi.useFakeTimers) — faking the clock here would also freeze
    // Testing Library's own waitFor polling, which relies on real timers by default.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const recentlySeen: AdminPlayerSummary = { ...PLAYER_A, lastSeenAt: oneHourAgo };
    const longAgoSeen: AdminPlayerSummary = { ...PLAYER_B, source: 'x', lastSeenAt: twoMonthsAgo };
    stubFetch([recentlySeen, longAgoSeen]);
    render(<AdminScreen token="tok" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('admin-players-table')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('admin-time-range'), { target: { value: '24h' } });
    expect(screen.getByTestId('admin-player-p1')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-player-p2')).toBeNull();

    fireEvent.change(screen.getByTestId('admin-time-range'), { target: { value: 'all' } });
    expect(screen.getByTestId('admin-player-p2')).toBeInTheDocument();
  });

  it('an account with no recorded activity (lastSeenAt null) is excluded by any time-range filter, not treated as "always in range"', async () => {
    stubFetch([PLAYER_A, PLAYER_B]); // PLAYER_B.lastSeenAt is null
    render(<AdminScreen token="tok" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('admin-players-table')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('admin-time-range'), { target: { value: '30d' } });
    expect(screen.queryByTestId('admin-player-p2')).toBeNull();
  });

  it('match and ledger rows in the detail view label amounts by their own currency, not an implicit $ (the item-4 fix)', async () => {
    const log: AdminPlayerLogResponse = {
      matches: [{ matchId: 'm2', gameId: 'coinflip', opponent: 'bob', result: 'win', amount: 90, runningBalance: 1732, currency: 'SOL', createdAt: '2026-10-01T00:00:00.000Z' }],
      ledgerEntries: [{ id: 'e2', type: 'GRANT', amount: 1642, currency: 'SOL', idempotencyKey: 'grant:p1:SOL', createdAt: '2026-09-01T00:00:00.000Z' }],
    };
    stubFetch([PLAYER_A], log);
    render(<AdminScreen token="tok" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('admin-players-table')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('admin-player-p1'));
    await waitFor(() => expect(screen.getByTestId('admin-match-m2')).toBeInTheDocument());

    expect(within(screen.getByTestId('admin-match-m2')).getByText('+90 SOL')).toBeInTheDocument();
    expect(within(screen.getByTestId('admin-match-m2')).getByText('1732 SOL')).toBeInTheDocument();
    expect(within(screen.getByTestId('admin-ledger-e2')).getByText('+1642 SOL')).toBeInTheDocument();
  });
});
