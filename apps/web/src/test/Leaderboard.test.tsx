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

  it('renders a win_rate row as a percentage', async () => {
    mockEntries([
      { rank: 1, playerId: 'alice', displayName: 'alice', score: 1, kind: 'win_rate', gamesPlayed: 2, wins: 2, winRate: 1 },
    ]);
    render(<LeaderboardScreen token="tok" gameId="rps" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('100% win rate')).toBeInTheDocument());
  });

  it('renders net_winnings rows as signed credits (positive and negative)', async () => {
    mockEntries([
      { rank: 1, playerId: 'alice', displayName: 'alice', score: 9, kind: 'net_winnings', netWinnings: 9 },
      { rank: 2, playerId: 'bob', displayName: 'bob', score: -10, kind: 'net_winnings', netWinnings: -10 },
    ]);
    render(<LeaderboardScreen token="tok" gameId="coinflip" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('+9 credits')).toBeInTheDocument());
    expect(screen.getByText('-10 credits')).toBeInTheDocument();
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
});
