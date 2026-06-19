// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GameListScreen } from '../screens/GameList.js';
import type { GameMeta } from '@rapidclash/shared';

const RPS: GameMeta = {
  id: 'rps',
  displayName: 'Rock Paper Scissors',
  minPlayers: 2,
  maxPlayers: 2,
  ranking: { kind: 'win_rate' },
  rakeRate: 0.025,
  bet: { minStake: 1, maxStake: 100, symmetricStake: true },
  averageDurationSec: 10,
};
const COINFLIP: GameMeta = {
  id: 'coinflip',
  displayName: 'Coinflip',
  minPlayers: 2,
  maxPlayers: 2,
  ranking: { kind: 'net_winnings' },
  rakeRate: 0.025,
  bet: { minStake: 1, maxStake: 100, symmetricStake: true },
  averageDurationSec: 5,
};

function mockGames(games: GameMeta[]) {
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => games } as Response);
}

describe('GameListScreen (re-skin)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders ONLY the games from /games as playable tiles', async () => {
    mockGames([RPS, COINFLIP]);
    render(<GameListScreen token="tok" onSelect={vi.fn()} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('game-tile-rps')).toBeInTheDocument());
    expect(screen.getByTestId('game-tile-coinflip')).toBeInTheDocument();
    // Option B: the name is baked into the art (not shown as text), but kept as the button's
    // accessible name; the stake range + ranking remain visible.
    expect(screen.getByLabelText('Play Rock Paper Scissors')).toBeInTheDocument();
    expect(screen.getByText(/1–100¢ · ~10s/)).toBeInTheDocument();
    expect(screen.getByText('Net winnings')).toBeInTheDocument(); // coinflip ranking
  });

  it('tapping a playable tile calls onSelect with that game meta', async () => {
    const onSelect = vi.fn();
    mockGames([RPS, COINFLIP]);
    render(<GameListScreen token="tok" onSelect={onSelect} onBack={vi.fn()} />);

    await waitFor(() => screen.getByTestId('game-tile-coinflip'));
    fireEvent.click(screen.getByTestId('game-tile-coinflip'));
    expect(onSelect).toHaveBeenCalledWith(COINFLIP);
  });

  it('renders coming-soon tiles for games NOT returned by /games, and they are non-interactive', async () => {
    const onSelect = vi.fn();
    mockGames([RPS, COINFLIP]);
    render(<GameListScreen token="tok" onSelect={onSelect} onBack={vi.fn()} />);

    await waitFor(() => screen.getByTestId('game-tile-rps'));

    // A representative coming-soon game is present, labelled, and NOT a playable tile.
    const chess = screen.getByTestId('coming-soon-chess');
    expect(chess).toBeInTheDocument();
    expect(screen.getByTestId('coming-soon-poker')).toBeInTheDocument();
    expect(screen.getAllByText('Coming soon').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('game-tile-chess')).toBeNull(); // not playable

    // It is not a button and clicking it never selects a game.
    expect(chess.tagName).not.toBe('BUTTON');
    fireEvent.click(chess);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('a server-registered game is NOT duplicated as coming-soon', async () => {
    // If the server ever registers chess, it must appear playable and drop from breadth.
    const CHESS: GameMeta = { ...RPS, id: 'chess', displayName: 'Chess', ranking: { kind: 'win_rate' } };
    mockGames([RPS, CHESS]);
    render(<GameListScreen token="tok" onSelect={vi.fn()} onBack={vi.fn()} />);

    await waitFor(() => screen.getByTestId('game-tile-chess'));
    expect(screen.queryByTestId('coming-soon-chess')).toBeNull();
  });

  it('shows a restyled error state when the fetch fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, statusText: 'Boom', json: async () => ({}) } as Response);
    render(<GameListScreen token="tok" onSelect={vi.fn()} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('uses play-money framing — no crypto / deposit / buy-chips copy', async () => {
    mockGames([RPS, COINFLIP]);
    const { container } = render(<GameListScreen token="tok" onSelect={vi.fn()} onBack={vi.fn()} />);
    await waitFor(() => screen.getByTestId('game-tile-rps'));
    expect(container.textContent?.toLowerCase()).not.toMatch(/crypto|deposit|buy chips|buy-chips/);
  });

  it('back button calls onBack', async () => {
    const onBack = vi.fn();
    mockGames([RPS]);
    render(<GameListScreen token="tok" onSelect={vi.fn()} onBack={onBack} />);
    await waitFor(() => screen.getByTestId('game-tile-rps'));
    fireEvent.click(screen.getByLabelText('Back'));
    expect(onBack).toHaveBeenCalled();
  });
});
