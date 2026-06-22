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

describe('HomeHubScreen (logged out)', () => {
  // A public open-challenge as returned by GET /open-challenges (carries gameId).
  const pub = (matchId: string, gameId: string, ownerName: string, stake: number) => ({
    matchId, gameId, ownerName, stake, openedAt: 100, expiresAt: Date.now() + 30_000, timeControlId: 'none',
  });
  // Default mock: public endpoints succeed; the open-challenges snapshot is empty unless overridden.
  function stubFetch(openChallenges: unknown[] = []) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/open-challenges')) return { ok: true, json: async () => openChallenges } as Response;
      if (u.includes('/games')) return { ok: true, json: async () => GAMES } as Response;
      if (u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  }
  beforeEach(() => stubFetch());
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('browses the grid via public /games; the wallet chip is "Sign in"; the ticker is the live public feed', async () => {
    render(<HomeHubScreen {...baseProps({ loggedIn: false, token: '' })} />);
    // The game grid still renders (public endpoint) so a visitor can browse.
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    // No fake balance — the chip is a "Sign in" affordance.
    expect(screen.getByTestId('hub-signin-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-wallet-chip')).toBeNull();
    // The ticker is the REAL public feed (no WS subscription) — not a teaser stub.
    expect(screen.getByTestId('home-ticker')).toBeInTheDocument();
    expect(screen.queryByTestId('home-ticker-teaser')).toBeNull();
  });

  it('renders real public challenges; JOIN captures the row\'s game + stake (for the auth wall)', async () => {
    stubFetch([pub('p1', 'coinflip', 'zed', 15), pub('p2', 'mines', 'max', 40)]);
    const onTakePublicChallenge = vi.fn();
    render(<HomeHubScreen {...baseProps({ loggedIn: false, token: '', onTakePublicChallenge })} />);

    // Real rows from GET /open-challenges (never fabricated).
    await waitFor(() => expect(screen.getByTestId('home-row-p1')).toBeInTheDocument());
    expect(screen.getByTestId('home-stake-p1').textContent).toBe('15¢');
    expect(screen.getByTestId('home-row-p2')).toBeInTheDocument();

    // A JOIN tap passes the row's matchId + gameId + stake so the auth wall can resume the take.
    fireEvent.click(screen.getByTestId('home-join-p1'));
    expect(onTakePublicChallenge).toHaveBeenCalledWith({ matchId: 'p1', gameId: 'coinflip', stake: 15 });
  });

  it('re-polls GET /open-challenges so the feed visibly moves', async () => {
    vi.useFakeTimers();
    stubFetch([pub('p1', 'coinflip', 'zed', 15)]);
    render(<HomeHubScreen {...baseProps({ loggedIn: false, token: '' })} />);

    const calls = () => (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((c) => String(c[0])).filter((u) => u.includes('/open-challenges')).length;

    await vi.advanceTimersByTimeAsync(0); // flush the mount fetch
    const afterMount = calls();
    expect(afterMount).toBeGreaterThanOrEqual(1);
    await vi.advanceTimersByTimeAsync(4_100); // one poll interval later
    expect(calls()).toBeGreaterThan(afterMount);
  });

  it('does not fetch the wallet or subscribe to WS feeds while logged out', async () => {
    const onTrackChallenges = vi.fn();
    render(<HomeHubScreen {...baseProps({ loggedIn: false, token: '', onTrackChallenges })} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    expect(onTrackChallenges).not.toHaveBeenCalled(); // the WS feed is auth-only
    const urls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/wallet'))).toBe(false); // wallet is auth-only
    expect(urls.some((u) => u.includes('/open-challenges'))).toBe(true); // the public read IS used
  });

  it('the sign-in affordances (chip + ticker) invoke the sign-in handler', async () => {
    const onOpenWallet = vi.fn();
    render(<HomeHubScreen {...baseProps({ loggedIn: false, token: '', onOpenWallet })} />);
    await waitFor(() => expect(screen.getByTestId('home-ticker-signin')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('home-ticker-signin'));
    fireEvent.click(screen.getByTestId('hub-signin-chip'));
    expect(onOpenWallet).toHaveBeenCalledTimes(2);
  });
});

describe('HomeHubScreen — grid taxonomy + controls (design frame)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/open-challenges')) return { ok: true, json: async () => [] } as Response;
      if (u.includes('/games')) return { ok: true, json: async () => GAMES } as Response;
      if (u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Originals excludes chess; Classics shows only chess', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('home-cat-originals'));
    expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument();
    expect(screen.getByTestId('home-tile-mines')).toBeInTheDocument();
    expect(screen.queryByTestId('home-tile-chess')).toBeNull(); // chess is a Classic, not an Original

    fireEvent.click(screen.getByTestId('home-cat-classics'));
    expect(screen.getByTestId('home-tile-chess')).toBeInTheDocument();
    expect(screen.queryByTestId('home-tile-coinflip')).toBeNull();
    expect(screen.queryByTestId('home-tile-mines')).toBeNull();
  });

  it('Events shows the Coin Flip tournament announcement (1 Sept 2026) — no $ / prize copy', async () => {
    const { container } = render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('home-cat-events'));
    const events = screen.getByTestId('home-events');
    expect(events.textContent).toMatch(/Coin Flip Showdown/i);
    expect(events.textContent).toMatch(/1 September 2026/i);
    // The grid of tiles is replaced by the announcement.
    expect(screen.queryByTestId('home-tile-coinflip')).toBeNull();
    // Play-money only — no real-money / prize-pool copy.
    expect(container.textContent ?? '').not.toMatch(/\$/);
    expect(events.textContent ?? '').not.toMatch(/prize pool/i);
  });

  it('Find filters tiles by substring', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('home-find-toggle'));
    fireEvent.change(screen.getByTestId('home-find-input'), { target: { value: 'che' } });
    expect(screen.getByTestId('home-tile-chess')).toBeInTheDocument();
    expect(screen.queryByTestId('home-tile-coinflip')).toBeNull();
    expect(screen.queryByTestId('home-tile-mines')).toBeNull();
  });

  it('Filter by game kind narrows the grid (Logic = chess + mines, not coinflip)', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('home-filter'));
    fireEvent.click(screen.getByTestId('home-filter-opt-logic'));
    expect(screen.getByTestId('home-tile-chess')).toBeInTheDocument();
    expect(screen.getByTestId('home-tile-mines')).toBeInTheDocument();
    expect(screen.queryByTestId('home-tile-coinflip')).toBeNull(); // coinflip is a Table game
  });
});
