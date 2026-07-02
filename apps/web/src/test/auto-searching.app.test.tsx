// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { App } from '../App.js';
import type { GameMeta } from '@rapidclash/shared';

// #152 — a hub must enter "Searching…" ONLY from an explicit user PLAY this session with an
// armed stake. No navigation/reconnect/stray-server-push path may auto-enter searching.

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

type MockSock = {
  url: string;
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: (() => void) | null;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

const META = (id: string, displayName: string): GameMeta => ({
  id, displayName, minPlayers: 2, maxPlayers: 2,
  ranking: { kind: 'net_winnings' }, bet: { minStake: 1, maxStake: 1000, symmetricStake: true },
  averageDurationSec: 10, rakeRate: 0.025,
});

let sockets: MockSock[];

function lastSock(): MockSock {
  return sockets[sockets.length - 1];
}

/** Deliver a server → client envelope on the live socket. */
function deliver(type: string, payload: unknown, matchId?: string): void {
  act(() => {
    lastSock().onmessage?.({ data: JSON.stringify({ type, payload, ...(matchId ? { matchId } : {}) }) });
  });
}

function openLiveSocket(): void {
  act(() => { lastSock().readyState = 1; lastSock().onopen?.(); });
}

describe('#152 — hubs never auto-enter Searching…', () => {
  beforeEach(() => {
    sockets = [];
    const ctor = vi.fn((url: string) => {
      const s: MockSock = { url, readyState: 0, onopen: null, onmessage: null, onclose: null, send: vi.fn(), close: vi.fn() };
      sockets.push(s);
      return s;
    });
    vi.stubGlobal('WebSocket', Object.assign(ctor, { OPEN: 1, CONNECTING: 0, CLOSING: 2, CLOSED: 3 }));
    localStorage.setItem('rc_token', 'tok');
    localStorage.setItem('rc_playerId', 'pid');
    localStorage.setItem('rc_username', 'alice');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games')) return { ok: true, json: async () => [META('coinflip', 'Coinflip')] } as Response;
      if (u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  async function enterCoinflipHub(): Promise<void> {
    await waitFor(() => expect(screen.getByTestId('home-hub')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('home-tile-coinflip'));
    await waitFor(() => expect(screen.getByTestId('hub-play')).toBeInTheDocument());
  }

  it('navigating away mid-search then back does NOT re-enter Searching…', async () => {
    render(<App />);
    openLiveSocket();
    await enterCoinflipHub();

    // Genuine user PLAY this session: arm a bet, press PLAY, server confirms the rest.
    fireEvent.click(screen.getByTestId('hub-bet-10'));
    fireEvent.click(screen.getByTestId('hub-play'));
    deliver('queue.waiting', { gameId: 'coinflip', matchId: 'm1', since: Date.now(), expiresAt: Date.now() + 30_000 });
    // Searching is now in place: the active Cancel control appears (WaitingBlock retired, #154).
    await waitFor(() => expect(screen.getByTestId('hub-cancel')).toBeInTheDocument());

    // Navigate Home WITHOUT cancelling, then re-open the hub.
    fireEvent.click(screen.getByTestId('hub-nav-games'));
    await waitFor(() => expect(screen.getByTestId('home-hub')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('home-tile-coinflip'));
    await waitFor(() => expect(screen.getByTestId('hub-play')).toBeInTheDocument());

    // The hub is back at Idle — NOT stranded in "Searching…": idle PLAY, no Cancel control.
    expect(screen.queryByTestId('hub-cancel')).toBeNull();
    expect(screen.getByTestId('hub-play')).toBeEnabled();
  });

  it('a stray server queue.waiting (no user PLAY this session) does not strand the hub in searching', async () => {
    render(<App />);
    openLiveSocket();
    await enterCoinflipHub();

    // No PLAY pressed — a server queue.waiting arrives out of nowhere.
    deliver('queue.waiting', { gameId: 'coinflip', matchId: 'm1', since: Date.now(), expiresAt: Date.now() + 30_000 });

    // The hub must stay at Idle (PLAY tappable), never auto-enter Searching with no armed stake.
    await waitFor(() => expect(screen.getByTestId('hub-play')).toBeInTheDocument());
    expect(screen.getByTestId('hub-play')).toBeEnabled(); // idle PLAY, not the disabled waiting label
    expect(screen.queryByTestId('hub-cancel')).toBeNull();
  });
});
