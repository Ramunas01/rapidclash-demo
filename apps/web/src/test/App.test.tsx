// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { App } from '../App.js';

// jsdom has no WebSocket; WsClient.connect()/disconnect() need a minimal stand-in.
class MockWebSocket {
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {}
  send = vi.fn();
  close = vi.fn();
}

describe('App — own alias persistence + logout (#34)', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    // A reload-style session: token/playerId/alias already persisted.
    localStorage.setItem('rc_token', 'tok');
    localStorage.setItem('rc_playerId', 'pid');
    localStorage.setItem('rc_username', 'alice');
    // Wallet mounts and fetches the balance.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ balance: 1000, entries: [] }),
    } as Response));
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('restores the alias from storage on reload and clears it on logout', async () => {
    render(<App />);

    // A reload lands on the Home hub; the wallet chip opens the Profile hub (alias + Log out).
    await waitFor(() => expect(screen.getByTestId('home-hub')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('hub-wallet-chip'));
    await waitFor(() => {
      expect(screen.getByTestId('profile-username').textContent).toBe('alice');
    });

    fireEvent.click(screen.getByTestId('profile-logout'));

    // Logout drops the stored alias in lockstep with the token/playerId…
    expect(localStorage.getItem('rc_username')).toBeNull();
    expect(localStorage.getItem('rc_token')).toBeNull();
    expect(localStorage.getItem('rc_playerId')).toBeNull();
    // …and we land on the logged-out Home hub (the single entry), wallet chip now "Sign in".
    await waitFor(() => expect(screen.getByTestId('home-hub')).toBeInTheDocument());
    expect(screen.getByTestId('hub-signin-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-wallet-chip')).toBeNull();
  });
});

describe('App — connection banner (#30)', () => {
  // Capture the socket(s) WsClient opens so the test can drive open/close.
  let sockets: Array<{ readyState: number; onopen: (() => void) | null; onclose: (() => void) | null }>;

  beforeEach(() => {
    sockets = [];
    const ctor = vi.fn((url: string) => {
      const s = {
        url,
        readyState: 0,
        onopen: null as (() => void) | null,
        onmessage: null,
        onclose: null as (() => void) | null,
        send: vi.fn(),
        close: vi.fn(),
      };
      sockets.push(s);
      return s;
    });
    vi.stubGlobal('WebSocket', Object.assign(ctor, { OPEN: 1, CONNECTING: 0, CLOSING: 2, CLOSED: 3 }));
    localStorage.setItem('rc_token', 'tok');
    localStorage.setItem('rc_playerId', 'pid');
    localStorage.setItem('rc_username', 'alice');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ balance: 1000, entries: [] }),
    } as Response));
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('shows a "Reconnecting…" banner when the socket drops, and hides it on reconnect', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('home-hub')).toBeInTheDocument());

    const sock = sockets[0];
    act(() => { sock.readyState = 1; sock.onopen?.(); }); // connected
    expect(screen.queryByTestId('ws-banner')).toBeNull();

    act(() => { sock.readyState = 3; sock.onclose?.(); }); // dropped
    expect(screen.getByTestId('ws-banner').textContent).toContain('Reconnecting');

    // A later successful (re)open clears the banner.
    const next = sockets[sockets.length - 1];
    act(() => { next.readyState = 1; next.onopen?.(); });
    expect(screen.queryByTestId('ws-banner')).toBeNull();
  });
});

describe('App — match.start routes by the server-authoritative gameId (open-challenges take fix)', () => {
  // The take-challenge path never sets pendingGameId, so screen routing must come
  // from the match.start payload. Capture the socket so the test can deliver one.
  type MockSock = {
    url: string;
    readyState: number;
    onopen: (() => void) | null;
    onmessage: ((ev: { data: string }) => void) | null;
    onclose: (() => void) | null;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let sockets: MockSock[];

  beforeEach(() => {
    sockets = [];
    const ctor = vi.fn((url: string) => {
      const s: MockSock = {
        url, readyState: 0, onopen: null, onmessage: null, onclose: null, send: vi.fn(), close: vi.fn(),
      };
      sockets.push(s);
      return s;
    });
    vi.stubGlobal('WebSocket', Object.assign(ctor, { OPEN: 1, CONNECTING: 0, CLOSING: 2, CLOSED: 3 }));
    // A reload-style session with NO game selected locally → pendingGameId is null.
    localStorage.setItem('rc_token', 'tok');
    localStorage.setItem('rc_playerId', 'pid');
    localStorage.setItem('rc_username', 'alice');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ balance: 1000, entries: [] }),
    } as Response));
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  /** Render the logged-in app, open its socket, and deliver one match.start. */
  async function deliverMatchStart(gameId: string, state: unknown) {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('home-hub')).toBeInTheDocument());
    const sock = sockets[0];
    act(() => { sock.readyState = 1; sock.onopen?.(); });
    const env = {
      type: 'match.start',
      matchId: 'm1',
      payload: { matchId: 'm1', opponent: 'bob-id', gameId, state },
    };
    act(() => { sock.onmessage?.({ data: JSON.stringify(env) }); });
  }

  it('routes to the chess board when gameId is "chess", even with pendingGameId null (the take case)', async () => {
    // No fen → the board placeholder renders, but it is unambiguously the chess screen.
    // Pre-fix this rendered the RPS board because routing fell back to the default.
    await deliverMatchStart('chess', { players: ['pid', 'bob-id'] });
    expect(screen.getByTestId('chess-board')).toBeInTheDocument();
    expect(screen.queryByText('Rock Paper Scissors')).toBeNull();
    expect(sessionStorage.getItem('rc_currentGameId')).toBe('chess');
  });

  it('routes an RPS match.start to the in-place RPS hub board (not the standalone screen)', async () => {
    await deliverMatchStart('rps', { players: ['pid', 'bob-id'], choices: {} });
    // RPS now drives the shared one-screen Game hub: its panel shows the rock/paper/scissors board.
    expect(screen.getByTestId('hub-board')).toBeInTheDocument();
    expect(screen.getByTestId('hub-move-rock')).toBeInTheDocument();
    expect(screen.queryByTestId('chess-board')).toBeNull();
  });

  it('routes a Coinflip match.start to the in-place hub board (not the standalone screen)', async () => {
    await deliverMatchStart('coinflip', { players: ['pid', 'bob-id'], choices: {} });
    // Coinflip drives the one-screen hub: a match.start activates the in-place game board.
    expect(screen.getByTestId('hub-board')).toBeInTheDocument();
    expect(screen.queryByTestId('chess-board')).toBeNull();
  });
});

describe('App — logged-out Home + auth wall at PLAY (resume)', () => {
  type MockSock = {
    url: string; readyState: number;
    onopen: (() => void) | null; onmessage: ((ev: { data: string }) => void) | null; onclose: (() => void) | null;
    send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>;
  };
  let sockets: MockSock[];
  const COINFLIP = {
    id: 'coinflip', displayName: 'Coinflip', minPlayers: 2, maxPlayers: 2,
    ranking: { kind: 'net_winnings' }, bet: { minStake: 1, maxStake: 100, symmetricStake: true },
    averageDurationSec: 5, rakeRate: 0.025,
  };

  beforeEach(() => {
    sockets = [];
    const ctor = vi.fn((url: string) => {
      const s: MockSock = { url, readyState: 0, onopen: null, onmessage: null, onclose: null, send: vi.fn(), close: vi.fn() };
      sockets.push(s);
      return s;
    });
    vi.stubGlobal('WebSocket', Object.assign(ctor, { OPEN: 1, CONNECTING: 0, CLOSING: 2, CLOSED: 3 }));
    // A resting public challenge for the logged-out ticker (GET /open-challenges).
    const PUB_ROW = {
      matchId: 'pub-1', gameId: 'coinflip', ownerName: 'zed', stake: 10,
      openedAt: 100, expiresAt: Date.now() + 30_000, timeControlId: 'none',
    };
    // NO token → logged out.
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/open-challenges')) return { ok: true, json: async () => [PUB_ROW] } as Response;
      if (u.includes('/games')) return { ok: true, json: async () => [COINFLIP] } as Response;
      if (u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      if (u.includes('/auth/register')) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        return { ok: true, json: async () => ({ token: 'NEWT', playerId: 'NEWP', balance: 1000, username: body.username }) } as Response;
      }
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => { localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); });

  it('a logged-out visitor lands on Home with a Sign-in chip + the live public ticker, and no WS is opened', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('home-hub')).toBeInTheDocument());
    expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument(); // public grid browses
    expect(screen.getByTestId('hub-signin-chip')).toBeInTheDocument();
    // The public open-challenges snapshot renders (real movement, no WS).
    await waitFor(() => expect(screen.getByTestId('home-row-pub-1')).toBeInTheDocument());
    expect(screen.queryByTestId('home-ticker-teaser')).toBeNull();
    expect(sockets.length).toBe(0); // the WS (auth) is not opened until sign-in
  });

  it('JOIN a public challenge while logged-out → auth modal → on register the take resumes over the freshly-connected WS', async () => {
    render(<App />);
    await waitFor(() => screen.getByTestId('home-hub'));

    // The logged-out ticker shows the resting public challenge; tap JOIN.
    await waitFor(() => screen.getByTestId('home-join-pub-1'));
    fireEvent.click(screen.getByTestId('home-join-pub-1'));

    // The auth wall fires — JOIN is gated even though browsing the feed is open.
    expect(await screen.findByTestId('auth-modal')).toBeInTheDocument();

    // Register → token stored + WS connects.
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'neo' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('auth-submit'));
    await waitFor(() => expect(sockets.length).toBe(1));

    // Open the socket → the captured JOIN intent replays as a challenge.take (the resume).
    act(() => { sockets[0].readyState = 1; sockets[0].onopen?.(); });
    const takes = sockets[0].send.mock.calls
      .map((c) => JSON.parse(String(c[0])))
      .filter((m: { type: string }) => m.type === 'challenge.take');
    expect(takes).toHaveLength(1);
    expect(takes[0].payload).toMatchObject({ matchId: 'pub-1' });
    expect(screen.queryByTestId('auth-modal')).toBeNull(); // modal dismissed on success
  });

  it('PLAY while logged-out → auth modal → on register the post resumes over the freshly-connected WS', async () => {
    render(<App />);
    await waitFor(() => screen.getByTestId('home-tile-coinflip'));

    // Browse into the Coinflip hub (no auth needed), pick a bet, hit PLAY.
    fireEvent.click(screen.getByTestId('home-tile-coinflip'));
    await waitFor(() => screen.getByTestId('hub-bet-10'));
    fireEvent.click(screen.getByTestId('hub-bet-10'));
    fireEvent.click(screen.getByTestId('hub-play'));

    // The auth wall fires only here.
    const modal = await screen.findByTestId('auth-modal');
    expect(modal).toBeInTheDocument();

    // Register → token stored + WS connects.
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'neo' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('auth-submit'));
    await waitFor(() => expect(sockets.length).toBe(1));

    // Open the socket → the captured PLAY intent replays as a queue.join (the resume).
    act(() => { sockets[0].readyState = 1; sockets[0].onopen?.(); });
    const joins = sockets[0].send.mock.calls
      .map((c) => JSON.parse(String(c[0])))
      .filter((m: { type: string }) => m.type === 'queue.join');
    expect(joins).toHaveLength(1);
    expect(joins[0].payload).toMatchObject({ gameId: 'coinflip', stake: 10 });
    expect(screen.queryByTestId('auth-modal')).toBeNull(); // modal dismissed on success
  });
});
