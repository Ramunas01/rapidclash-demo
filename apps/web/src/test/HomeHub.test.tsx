// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { HomeHubScreen } from '../screens/HomeHub.js';
import type { GameMeta, OpenChallenge } from '@rapidclash/shared';

type Props = Parameters<typeof HomeHubScreen>[0];

const META = (id: string, displayName: string): GameMeta => ({
  id, displayName, minPlayers: 2, maxPlayers: 2,
  ranking: { kind: 'net_winnings' }, bet: { minStake: 1, maxStake: 100, symmetricStake: true },
  averageDurationSec: 10, rakeRate: 0.025,
});

// /games returns the live PvP set; leaderboard/wallet return their shapes.
const GAMES: GameMeta[] = [META('coinflip', 'Coinflip'), META('chess', 'Chess'), META('mines', 'Mines')];

function baseProps(over: Partial<Props> = {}): Props {
  return {
    token: 'tok',
    balance: 1000,
    challengesByGame: {},
    onTrackChallenges: vi.fn(),
    onUntrackChallenges: vi.fn(),
    onTakeChallenge: vi.fn(),
    onSelectGame: vi.fn(),
    onOpenWallet: vi.fn(),
    onHome: vi.fn(),
    ...over,
  };
}

const challenge = (matchId: string, ownerName: string, stake: number, openedAt: number): OpenChallenge => ({
  matchId, ownerName, stake, openedAt, expiresAt: Date.now() + 30_000, timeControlId: 'none',
});

describe('HomeHubScreen', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games')) return { ok: true, json: async () => GAMES } as Response;
      if (u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders PvP games as playable tiles and house games as inert "coming soon"', async () => {
    const onSelectGame = vi.fn();
    render(<HomeHubScreen {...baseProps({ onSelectGame })} />);

    // Playable: data-driven from /games.
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    expect(screen.getByTestId('home-tile-chess')).toBeInTheDocument();
    expect(screen.getByTestId('home-tile-mines')).toBeInTheDocument();
    // Tapping a playable tile routes to that game's flow.
    fireEvent.click(screen.getByTestId('home-tile-coinflip'));
    expect(onSelectGame).toHaveBeenCalledWith(expect.objectContaining({ id: 'coinflip' }));

    // House games render as coming-soon with NO play handler (a div, not a button).
    const limbo = screen.getByTestId('home-coming-soon-limbo');
    expect(limbo).toBeInTheDocument();
    expect(limbo.tagName).not.toBe('BUTTON');
    expect(screen.getByTestId('home-coming-soon-roulette')).toBeInTheDocument();
    // A house game is never a playable tile.
    expect(screen.queryByTestId('home-tile-limbo')).toBeNull();
  });

  it('subscribes to every game feed for the cross-game ticker once games load', async () => {
    const onTrackChallenges = vi.fn();
    render(<HomeHubScreen {...baseProps({ onTrackChallenges })} />);
    await waitFor(() => expect(onTrackChallenges).toHaveBeenCalled());
    expect(onTrackChallenges).toHaveBeenCalledWith(['coinflip', 'chess', 'mines']);
  });

  it('merges per-game feeds into one ticker (oldest first) and JOIN takes that challenge', async () => {
    const onTakeChallenge = vi.fn();
    const challengesByGame = {
      coinflip: [challenge('c1', 'alice', 5, 100)],
      mines: [challenge('m1', 'bob', 25, 50)],
    };
    render(<HomeHubScreen {...baseProps({ challengesByGame, onTakeChallenge })} />);

    // Both games' challenges appear in the one ticker.
    const ticker = within(screen.getByTestId('home-ticker'));
    expect(ticker.getByTestId('home-row-c1')).toBeInTheDocument();
    expect(ticker.getByTestId('home-row-m1')).toBeInTheDocument();
    // Stakes render in ¢ and the row names its game (real data, not fabricated).
    expect(ticker.getByTestId('home-stake-c1').textContent).toBe('5¢');
    expect(ticker.getByTestId('home-stake-m1').textContent).toBe('25¢');
    await waitFor(() => expect(ticker.getByTestId('home-row-game-m1').textContent).toBe('Mines'));

    // Oldest-first: m1 (openedAt 50) above c1 (openedAt 100).
    const rows = ticker.getAllByTestId(/^home-row-[a-z0-9]+$/);
    expect(rows[0].getAttribute('data-testid')).toBe('home-row-m1');

    fireEvent.click(ticker.getByTestId('home-join-c1'));
    expect(onTakeChallenge).toHaveBeenCalledWith('c1');
  });

  it('JOIN refuses clearly when the stake is uncovered, without taking', () => {
    const onTakeChallenge = vi.fn();
    const challengesByGame = { coinflip: [challenge('c1', 'alice', 50, 100)] };
    render(<HomeHubScreen {...baseProps({ balance: 5, challengesByGame, onTakeChallenge })} />);
    fireEvent.click(screen.getByTestId('home-join-c1'));
    expect(onTakeChallenge).not.toHaveBeenCalled();
    expect(screen.getByTestId('home-ticker-notice').textContent).toMatch(/not enough/i);
  });

  it('is sanitized: no $ anywhere on the hub', async () => {
    const challengesByGame = { coinflip: [challenge('c1', 'alice', 5, 100)] };
    const { container } = render(<HomeHubScreen {...baseProps({ challengesByGame })} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    expect(container.textContent ?? '').not.toMatch(/\$/);
  });
});
