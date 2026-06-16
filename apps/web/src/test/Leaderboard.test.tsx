// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LeaderboardScreen, formatStat } from '../screens/Leaderboard.js';
import type { LeaderboardEntry } from '@rapidclash/shared';

function mockEntries(entries: LeaderboardEntry[]) {
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => entries } as Response);
}

describe('LeaderboardScreen — render by ranking kind', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders a win_rate row as a percentage with a wins/games subline', async () => {
    mockEntries([
      { rank: 1, playerId: 'alice', displayName: 'alice', score: 1, kind: 'win_rate', gamesPlayed: 2, wins: 2, winRate: 1 },
    ]);
    render(<LeaderboardScreen token="tok" gameId="rps" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('100% win rate')).toBeInTheDocument());
    // win_rate rows expose the underlying W/games counts, not a money amount.
    expect(screen.getByText('2W · 2 games')).toBeInTheDocument();
    // never frame a skill board as money.
    expect(screen.queryByText(/credits/i)).not.toBeInTheDocument();
  });

  it('renders an elo row as a rounded rating with a "rating" subline', async () => {
    mockEntries([
      { rank: 1, playerId: 'alice', displayName: 'alice', score: 1531.26, kind: 'elo', rating: 1531.26 },
    ]);
    render(<LeaderboardScreen token="tok" gameId="chess" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('1531 ELO')).toBeInTheDocument());
    expect(screen.getByText('rating')).toBeInTheDocument();
    // elo is a skill board, never framed as money.
    expect(screen.queryByText(/credits/i)).not.toBeInTheDocument();
  });

  it('renders net_winnings rows as signed credits (positive and negative)', async () => {
    mockEntries([
      { rank: 1, playerId: 'alice', displayName: 'alice', score: 9, kind: 'net_winnings', netWinnings: 9 },
      { rank: 2, playerId: 'bob', displayName: 'bob', score: -10, kind: 'net_winnings', netWinnings: -10 },
    ]);
    render(<LeaderboardScreen token="tok" gameId="coinflip" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('+9 credits')).toBeInTheDocument());
    // ADR-007: a row can be negative because net_winnings sums to −rake across players.
    expect(screen.getByText('-10 credits')).toBeInTheDocument();
    // and that negative is explained as the platform fee, not a bug.
    expect(screen.getAllByText('net of platform fee').length).toBeGreaterThan(0);
  });

  // #46 — the board fetched is the ACTIVE game's, not hardcoded 'rps'.
  it('fetches the active game\'s board (coinflip → /leaderboard/coinflip)', async () => {
    mockEntries([
      { rank: 1, playerId: 'alice', displayName: 'alice', score: 9, kind: 'net_winnings', netWinnings: 9 },
    ]);
    render(<LeaderboardScreen token="tok" gameId="coinflip" onBack={() => {}} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain('/leaderboard/coinflip');
  });

  it('shows an empty state when there are no entries', async () => {
    mockEntries([]);
    render(<LeaderboardScreen token="tok" gameId="rps" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('No matches yet')).toBeInTheDocument());
  });

  // Play-money guard: no crypto/deposit/buy-chips framing in the rendered board.
  it('keeps play-money framing (no deposit / crypto / buy-chips copy)', async () => {
    mockEntries([
      { rank: 1, playerId: 'alice', displayName: 'alice', score: 9, kind: 'net_winnings', netWinnings: 9 },
    ]);
    const { container } = render(<LeaderboardScreen token="tok" gameId="coinflip" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('+9 credits')).toBeInTheDocument());
    expect(container.textContent).not.toMatch(/deposit|crypto|buy chips|usd|\$/i);
  });
});

describe('formatStat', () => {
  it('formats win_rate as a rounded percentage', () => {
    expect(
      formatStat({ rank: 1, playerId: 'a', displayName: 'a', score: 0.5, kind: 'win_rate', gamesPlayed: 2, wins: 1, winRate: 0.5 }),
    ).toBe('50% win rate');
  });

  it('formats net_winnings with an explicit sign', () => {
    const base = { rank: 1, playerId: 'a', displayName: 'a', kind: 'net_winnings' as const };
    expect(formatStat({ ...base, score: 9, netWinnings: 9 })).toBe('+9 credits');
    expect(formatStat({ ...base, score: -10, netWinnings: -10 })).toBe('-10 credits');
    expect(formatStat({ ...base, score: 0, netWinnings: 0 })).toBe('0 credits');
  });

  it('formats elo as a rounded rating', () => {
    const base = { rank: 1, playerId: 'a', displayName: 'a', kind: 'elo' as const };
    expect(formatStat({ ...base, score: 1500, rating: 1500 })).toBe('1500 ELO');
    expect(formatStat({ ...base, score: 1531.26, rating: 1531.26 })).toBe('1531 ELO');
  });
});
