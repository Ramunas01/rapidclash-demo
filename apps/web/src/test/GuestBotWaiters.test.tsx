// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { GuestBotWaiters } from '../guest/GuestBotWaiters.js';
import type { PublicOpenChallenge } from '@rapidclash/shared';

// Issue #354 (5/5, guest bot economy) — the guest-scoped "who's on duty" list. The ONE hard
// requirement from the issue: this component must never touch `challengesByGame`/the real WS
// aggregate. `GuestBotWaitersProps` (see the component) has no such prop at all — there is
// nothing for this component to read even by mistake. These tests instead verify the ACTUAL data
// path it does use: a plain `GET /guest/open-challenges` fetch, nothing else.

function row(gameId: string, stake: number, matchId = `${gameId}-${stake}`): PublicOpenChallenge {
  return { gameId, matchId, ownerName: 'Demo Opponent 🤖', stake, openedAt: Date.now() - 10_000, expiresAt: Date.now() + 60_000, timeControlId: 'none' };
}

function stubFetch(rows: PublicOpenChallenge[] | unknown) {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string) => {
    calls.push(String(url));
    return { ok: true, json: async () => rows } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('GuestBotWaiters — data source (issue #354 hard requirement)', () => {
  it('reads ONLY GET /guest/open-challenges — never /open-challenges (the real public snapshot) or any WS-driven aggregate', async () => {
    const { calls } = stubFetch([row('coinflip', 5)]);
    render(<GuestBotWaiters gameId="coinflip" balance={1000} onTake={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('guest-bot-waiter-5')).toBeInTheDocument());

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/guest/open-challenges');
    expect(calls.some((u) => u.includes('/open-challenges') && !u.includes('/guest/'))).toBe(false);
  });

  it('is resilient to a malformed (non-array) response — renders the empty state, never throws', async () => {
    stubFetch({ balance: 1000, entries: [] }); // shape a generic fallback fetch mock might return
    render(<GuestBotWaiters gameId="coinflip" balance={1000} onTake={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('guest-bot-waiters-empty')).toBeInTheDocument());
  });
});

describe('GuestBotWaiters — rendering the list', () => {
  it('shows the empty state when nothing is resting', async () => {
    stubFetch([]);
    render(<GuestBotWaiters gameId="coinflip" balance={1000} onTake={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('guest-bot-waiters-empty')).toBeInTheDocument());
  });

  it('renders only rows for the current game, sorted by stake ascending, each labelled with its stake', async () => {
    stubFetch([row('chess', 50), row('coinflip', 25), row('coinflip', 5), row('coinflip', 10)]);
    render(<GuestBotWaiters gameId="coinflip" balance={1000} onTake={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('guest-bot-waiter-5')).toBeInTheDocument());

    expect(screen.queryByTestId('guest-bot-waiter-50')).toBeNull(); // chess lane excluded
    const rows = screen.getAllByText('Demo Opponent 🤖');
    expect(rows).toHaveLength(3);
    // DOM order follows the sorted array (5, 10, 25).
    const stakeOrder = ['guest-bot-waiter-5', 'guest-bot-waiter-10', 'guest-bot-waiter-25'];
    const positions = stakeOrder.map((id) => screen.getByTestId(id));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i - 1].compareDocumentPosition(positions[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});

describe('GuestBotWaiters — JOIN', () => {
  it('clicking JOIN calls onTake with the row\'s matchId', async () => {
    stubFetch([row('coinflip', 10, 'match-abc')]);
    const onTake = vi.fn();
    render(<GuestBotWaiters gameId="coinflip" balance={1000} onTake={onTake} />);
    await waitFor(() => expect(screen.getByTestId('guest-bot-waiter-join-10')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('guest-bot-waiter-join-10'));
    expect(onTake).toHaveBeenCalledWith('match-abc');
    expect(screen.queryByTestId('guest-bot-waiters-notice')).toBeNull();
  });

  it('an unaffordable stake shows a notice and does NOT call onTake', async () => {
    stubFetch([row('coinflip', 500)]);
    const onTake = vi.fn();
    render(<GuestBotWaiters gameId="coinflip" balance={10} onTake={onTake} />);
    await waitFor(() => expect(screen.getByTestId('guest-bot-waiter-join-500')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('guest-bot-waiter-join-500'));
    expect(onTake).not.toHaveBeenCalled();
    expect(screen.getByTestId('guest-bot-waiters-notice')).toBeInTheDocument();
  });

  it('joinDisabled greys out every row and JOIN is a no-op', async () => {
    stubFetch([row('coinflip', 10, 'match-abc')]);
    const onTake = vi.fn();
    render(<GuestBotWaiters gameId="coinflip" balance={1000} onTake={onTake} joinDisabled />);
    await waitFor(() => expect(screen.getByTestId('guest-bot-waiter-join-10')).toBeDisabled());

    fireEvent.click(screen.getByTestId('guest-bot-waiter-join-10'));
    expect(onTake).not.toHaveBeenCalled();
  });
});

describe('GuestBotWaiters — polling', () => {
  it('re-fetches on an interval so a freshly-reposted bot (after being taken) reappears', async () => {
    vi.useFakeTimers();
    const rows: PublicOpenChallenge[] = [];
    const fn = vi.fn(async () => ({ ok: true, json: async () => rows }) as Response);
    vi.stubGlobal('fetch', fn);

    render(<GuestBotWaiters gameId="coinflip" balance={1000} onTake={vi.fn()} />);
    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(1));

    rows.push(row('coinflip', 10));
    await vi.advanceTimersByTimeAsync(4_000);
    await vi.waitFor(() => expect(screen.getByTestId('guest-bot-waiter-10')).toBeInTheDocument());
  });
});
