// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { GUEST_COINFLIP_STAKE } from '@rapidclash/shared';
import { App } from '../App.js';

// The Coinflip hub's coin is a real Three.js cylinder now (COINFLIP_COIN.md); jsdom has no WebGL
// context, so the real THREE.WebGLRenderer throws when this file routes into the Coinflip screen.
// Stub it (mirrors the canvas-confetti-style mocks used elsewhere) — this file exercises App-level
// routing/state, not the coin's own animation curve (see Coin.test.tsx for that).
vi.mock('three', async () => import('./three-stub.js'));

// Force reduced motion + a controlled rAF/getContext stub for every test in this file, same reasoning
// as CoinflipHub.test.tsx: (a) short flip settle instead of the full ~1.8-2.4s spin, (b) jsdom's own
// rAF stops firing at all once some test elsewhere toggles fake timers, and (c) jsdom has no real 2D
// canvas context either (silences a noisy "not implemented" console.error from the cap-texture paint).
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal(
    'requestAnimationFrame',
    (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});

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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ balance: 1000, entries: [] }),
      } as Response)
    );
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
  let sockets: Array<{
    readyState: number;
    onopen: (() => void) | null;
    onclose: (() => void) | null;
  }>;

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
    vi.stubGlobal(
      'WebSocket',
      Object.assign(ctor, { OPEN: 1, CONNECTING: 0, CLOSING: 2, CLOSED: 3 })
    );
    localStorage.setItem('rc_token', 'tok');
    localStorage.setItem('rc_playerId', 'pid');
    localStorage.setItem('rc_username', 'alice');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ balance: 1000, entries: [] }),
      } as Response)
    );
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
    act(() => {
      sock.readyState = 1;
      sock.onopen?.();
    }); // connected
    expect(screen.queryByTestId('ws-banner')).toBeNull();

    act(() => {
      sock.readyState = 3;
      sock.onclose?.();
    }); // dropped
    expect(screen.getByTestId('ws-banner').textContent).toContain('Reconnecting');

    // A later successful (re)open clears the banner.
    const next = sockets[sockets.length - 1];
    act(() => {
      next.readyState = 1;
      next.onopen?.();
    });
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
        url,
        readyState: 0,
        onopen: null,
        onmessage: null,
        onclose: null,
        send: vi.fn(),
        close: vi.fn(),
      };
      sockets.push(s);
      return s;
    });
    vi.stubGlobal(
      'WebSocket',
      Object.assign(ctor, { OPEN: 1, CONNECTING: 0, CLOSING: 2, CLOSED: 3 })
    );
    // A reload-style session with NO game selected locally → pendingGameId is null.
    localStorage.setItem('rc_token', 'tok');
    localStorage.setItem('rc_playerId', 'pid');
    localStorage.setItem('rc_username', 'alice');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ balance: 1000, entries: [] }),
      } as Response)
    );
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
    act(() => {
      sock.readyState = 1;
      sock.onopen?.();
    });
    const env = {
      type: 'match.start',
      matchId: 'm1',
      payload: { matchId: 'm1', opponent: 'bob-id', gameId, state },
    };
    act(() => {
      sock.onmessage?.({ data: JSON.stringify(env) });
    });
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
    url: string;
    readyState: number;
    onopen: (() => void) | null;
    onmessage: ((ev: { data: string }) => void) | null;
    onclose: (() => void) | null;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let sockets: MockSock[];
  const COINFLIP = {
    id: 'coinflip',
    displayName: 'Coinflip',
    minPlayers: 2,
    maxPlayers: 2,
    ranking: { kind: 'net_winnings' },
    bet: { minStake: 1, maxStake: 100, symmetricStake: true },
    averageDurationSec: 5,
    rakeRate: 0.025,
  };

  beforeEach(() => {
    sockets = [];
    const ctor = vi.fn((url: string) => {
      const s: MockSock = {
        url,
        readyState: 0,
        onopen: null,
        onmessage: null,
        onclose: null,
        send: vi.fn(),
        close: vi.fn(),
      };
      sockets.push(s);
      return s;
    });
    vi.stubGlobal(
      'WebSocket',
      Object.assign(ctor, { OPEN: 1, CONNECTING: 0, CLOSING: 2, CLOSED: 3 })
    );
    // A resting public challenge for the logged-out ticker (GET /open-challenges).
    const PUB_ROW = {
      matchId: 'pub-1',
      gameId: 'coinflip',
      ownerName: 'zed',
      ownerTier: 'Unranked',
      stake: 10,
      openedAt: 100,
      expiresAt: Date.now() + 30_000,
      timeControlId: 'none',
    };
    // NO token → logged out.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('/open-challenges'))
          return { ok: true, json: async () => [PUB_ROW] } as Response;
        if (u.includes('/games')) return { ok: true, json: async () => [COINFLIP] } as Response;
        if (u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
        if (u.includes('/auth/register')) {
          const body = init?.body ? JSON.parse(String(init.body)) : {};
          return {
            ok: true,
            json: async () => ({
              token: 'NEWT',
              playerId: 'NEWP',
              balance: 1000,
              username: body.username,
            }),
          } as Response;
        }
        return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
      })
    );
  });
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('a logged-out visitor lands on Home with a Sign-in chip + the live public ticker, and no WS is opened', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('home-hub')).toBeInTheDocument());
    expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument(); // public grid browses
    expect(screen.getByTestId('hub-signin-chip')).toBeInTheDocument();
    // The public open-challenges snapshot renders (real movement, no WS) in the Games-page
    // carousel (#305) — rows are keyed by the carousel's own synthetic uid, not matchId (the
    // pool can wrap when smaller than the 11-row window), so look up by `data-match-id`.
    await waitFor(() => expect(document.querySelector('[data-match-id="pub-1"]')).toBeTruthy());
    expect(sockets.length).toBe(0); // the WS (auth) is not opened until sign-in
  });

  // Ticket 2026-09-13#5, item 1: the prototype's own `goRewards` has no login check (only
  // `goAccount` gates) — a logged-out tap on the Rewards nav item must land directly on the
  // Rewards hub, not the auth wall. This REVERSES the old `onRewardsTap` gate (previously the
  // same shape as `onAccountTap`) — deliberately, not a regression.
  it('tapping Rewards while logged-out lands directly on the Rewards hub, not the auth wall', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('home-hub')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('hub-nav-rewards'));
    await waitFor(() => expect(screen.getByTestId('rewards-hub')).toBeInTheDocument());
    expect(screen.queryByTestId('auth-modal')).toBeNull();
  });

  it('JOIN a public challenge while logged-out → auth modal → on register the user LANDS on that hub with the stake armed and nothing auto-fires', async () => {
    render(<App />);
    await waitFor(() => screen.getByTestId('home-hub'));

    // The logged-out carousel shows the resting public challenge; tap JOIN.
    await waitFor(() => expect(document.querySelector('[data-match-id="pub-1"]')).toBeTruthy());
    const pubRow = document.querySelector('[data-match-id="pub-1"]') as HTMLElement;
    fireEvent.click(within(pubRow).getByTestId(/^games-carousel-join-/));

    // The auth wall fires — JOIN is gated even though browsing the feed is open.
    expect(await screen.findByTestId('auth-modal')).toBeInTheDocument();

    // Register → token stored + WS connects.
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'neo' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('auth-submit'));
    await waitFor(() => expect(sockets.length).toBe(1));

    // Open the socket. With auto-resume removed NOTHING fires on connect — the user has landed on
    // the intent's hub with the stake pre-armed and must press PLAY (post-your-own, no auto-join).
    act(() => {
      sockets[0].readyState = 1;
      sockets[0].onopen?.();
    });
    const fired = sockets[0].send.mock.calls
      .map((c) => JSON.parse(String(c[0])))
      .filter((m: { type: string }) => m.type === 'challenge.take' || m.type === 'queue.join');
    expect(fired).toHaveLength(0); // no take / no join — nothing auto-fires post-sign-in

    expect(screen.queryByTestId('auth-modal')).toBeNull(); // modal dismissed on success
    // Landed on the Coinflip hub with the stake armed → PLAY is ready to commit.
    await waitFor(() => expect(screen.getByTestId('hub-play')).toBeEnabled());
  });

  it('PLAY while logged-out → auth modal → on register the user LANDS on the hub with the stake armed and nothing auto-fires', async () => {
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

    // Open the socket. Auto-resume is gone → NO queue.join fires on connect. The user is back on the
    // Coinflip hub with the stake pre-armed and presses PLAY to post (an explicit user action).
    act(() => {
      sockets[0].readyState = 1;
      sockets[0].onopen?.();
    });
    const joins = sockets[0].send.mock.calls
      .map((c) => JSON.parse(String(c[0])))
      .filter((m: { type: string }) => m.type === 'queue.join');
    expect(joins).toHaveLength(0); // nothing auto-fires post-sign-in

    expect(screen.queryByTestId('auth-modal')).toBeNull(); // modal dismissed on success
    // Landed back on the Coinflip hub with the 10 stake armed → PLAY is ready.
    await waitFor(() => expect(screen.getByTestId('hub-play')).toBeEnabled());
  });
});

describe('App — hubs no longer auto-enter Searching on entry after another game (#152 follow-up)', () => {
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
  const meta = (id: string, displayName: string) => ({
    id,
    displayName,
    minPlayers: 2,
    maxPlayers: 2,
    ranking: { kind: 'net_winnings' },
    bet: { minStake: 1, maxStake: 100, symmetricStake: true },
    averageDurationSec: 5,
    rakeRate: 0.025,
  });
  const COINFLIP = meta('coinflip', 'Coinflip');
  const RPS = meta('rps', 'Rock Paper Scissors');

  beforeEach(() => {
    sockets = [];
    const ctor = vi.fn((url: string) => {
      const s: MockSock = {
        url,
        readyState: 0,
        onopen: null,
        onmessage: null,
        onclose: null,
        send: vi.fn(),
        close: vi.fn(),
      };
      sockets.push(s);
      return s;
    });
    vi.stubGlobal(
      'WebSocket',
      Object.assign(ctor, { OPEN: 1, CONNECTING: 0, CLOSING: 2, CLOSED: 3 })
    );
    // Logged-in reload session with a two-game roster (so the related rail can switch hubs).
    localStorage.setItem('rc_token', 'tok');
    localStorage.setItem('rc_playerId', 'pid');
    localStorage.setItem('rc_username', 'alice');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/games'))
          return { ok: true, json: async () => [COINFLIP, RPS] } as Response;
        return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
      })
    );
  });
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  /** Deliver one server envelope over the open socket. */
  function deliver(sock: MockSock, type: string, payload: unknown) {
    act(() => {
      sock.onmessage?.({ data: JSON.stringify({ type, payload }) });
    });
  }

  /** Render logged-in, open the socket, enter the Coinflip hub, arm a bet and press PLAY. */
  async function playCoinflip() {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('home-hub')).toBeInTheDocument());
    const sock = sockets[0];
    act(() => {
      sock.readyState = 1;
      sock.onopen?.();
    });
    fireEvent.click(await screen.findByTestId('home-tile-coinflip'));
    fireEvent.click(await screen.findByTestId('hub-bet-10'));
    fireEvent.click(screen.getByTestId('hub-play'));
    return sock;
  }

  const sent = (sock: MockSock, type: string) =>
    sock.send.mock.calls
      .map((c) => JSON.parse(String(c[0])))
      .filter((m: { type: string }) => m.type === type);

  it('switching hubs abandons a leftover search — the next hub opens idle, not Searching', async () => {
    const sock = await playCoinflip();
    deliver(sock, 'queue.waiting', {
      gameId: 'coinflip',
      matchId: 'q1',
      since: 0,
      expiresAt: Date.now() + 90_000,
    });
    await waitFor(() => expect(screen.getByTestId('hub-waiting-countdown')).toBeInTheDocument());

    // Switch to the RPS hub via the related rail (handleSelectGame) while a search is in flight.
    fireEvent.click(await screen.findByTestId('hub-related-rps'));

    // The RPS hub opens clean: no leftover countdown, and the Coinflip queue was left (refund).
    await waitFor(() => expect(screen.queryByTestId('hub-waiting-countdown')).toBeNull());
    expect(sent(sock, 'queue.leave').some((m) => m.payload.gameId === 'coinflip')).toBe(true);
  });

  it('a queue.waiting for a DIFFERENT game is ignored (no cross-game countdown)', async () => {
    const sock = await playCoinflip();
    // A leftover/stray waiting for another game must NOT drive this hub's countdown.
    deliver(sock, 'queue.waiting', {
      gameId: 'chess',
      matchId: 'x',
      since: 0,
      expiresAt: Date.now() + 90_000,
    });
    expect(screen.queryByTestId('hub-waiting-countdown')).toBeNull();
    // The active game's own waiting DOES start it.
    deliver(sock, 'queue.waiting', {
      gameId: 'coinflip',
      matchId: 'q1',
      since: 0,
      expiresAt: Date.now() + 90_000,
    });
    await waitFor(() => expect(screen.getByTestId('hub-waiting-countdown')).toBeInTheDocument());
  });

  it('the countdown reaching expiry auto-reverts (no stuck 0:00) — lands on "No opponent found"', async () => {
    const sock = await playCoinflip();
    // A waiting whose server deadline has already passed → auto-resolve, never dead-end at 0:00.
    deliver(sock, 'queue.waiting', {
      gameId: 'coinflip',
      matchId: 'q1',
      since: 0,
      expiresAt: Date.now() - 1,
    });
    await waitFor(() =>
      expect(screen.getByTestId('hub-no-opponent').textContent).toContain('No opponent found')
    );
    expect(screen.queryByTestId('hub-waiting-countdown')).toBeNull();
    expect(sent(sock, 'queue.leave').some((m) => m.payload.gameId === 'coinflip')).toBe(true);
  });
});

describe('App — round-scoped state wiped as one unit on the destroy events (PLAY / leave / enter)', () => {
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
  const meta = (id: string, displayName: string) => ({
    id,
    displayName,
    minPlayers: 2,
    maxPlayers: 2,
    ranking: { kind: 'net_winnings' },
    bet: { minStake: 1, maxStake: 100, symmetricStake: true },
    averageDurationSec: 5,
    rakeRate: 0.025,
  });
  const ROSTER = [
    meta('coinflip', 'Coinflip'),
    meta('rps', 'Rock Paper Scissors'),
    meta('blackjack', 'Blackjack'),
  ];

  // A finished Coinflip round: both picks revealed + the flip (drives the own/opponent pick pills).
  const COINFLIP_DONE = {
    players: ['pid', 'bob-id'],
    choices: { pid: 'heads', 'bob-id': 'tails' },
    result: 'heads',
  };
  // A finished Blackjack hand: both hands revealed (drives the persistent on-board cards).
  const BLACKJACK_DONE = {
    players: ['pid', 'bob-id'],
    round: 0,
    draws: 0,
    winner: 'pid',
    hands: {
      pid: {
        cards: [
          { rank: 'K', suit: '♠' },
          { rank: 'Q', suit: '♥' },
        ],
        done: true,
      },
      'bob-id': {
        cards: [
          { rank: '9', suit: '♣' },
          { rank: '8', suit: '♦' },
        ],
        done: true,
      },
    },
  };

  beforeEach(() => {
    sockets = [];
    const ctor = vi.fn((url: string) => {
      const s: MockSock = {
        url,
        readyState: 0,
        onopen: null,
        onmessage: null,
        onclose: null,
        send: vi.fn(),
        close: vi.fn(),
      };
      sockets.push(s);
      return s;
    });
    vi.stubGlobal(
      'WebSocket',
      Object.assign(ctor, { OPEN: 1, CONNECTING: 0, CLOSING: 2, CLOSED: 3 })
    );
    localStorage.setItem('rc_token', 'tok');
    localStorage.setItem('rc_playerId', 'pid');
    localStorage.setItem('rc_username', 'alice');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/games')) return { ok: true, json: async () => ROSTER } as Response;
        return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
      })
    );
    // jsdom has no layout — the Coinflip board scrolls itself into view on a reveal.
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  function deliver(sock: MockSock, type: string, payload: unknown) {
    act(() => {
      sock.onmessage?.({ data: JSON.stringify({ type, payload }) });
    });
  }

  /** Enter a hub, PLAY, then resolve into a match and END it → the finished-round result view. */
  async function enterAndFinish(gameId: string, state: unknown): Promise<MockSock> {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('home-hub')).toBeInTheDocument());
    const sock = sockets[0];
    act(() => {
      sock.readyState = 1;
      sock.onopen?.();
    });
    fireEvent.click(await screen.findByTestId(`home-tile-${gameId}`));
    fireEvent.click(await screen.findByTestId('hub-bet-10'));
    fireEvent.click(screen.getByTestId('hub-play'));
    deliver(sock, 'match.start', { matchId: 'm1', opponent: 'bob-id', gameId, state });
    deliver(sock, 'match.end', {
      outcome: { type: 'win', winner: 'pid' },
      settlement: { delta: 19, newBalance: 1019 },
    });
    // Settle into the RESULT phase (PLAY re-enabled). Coinflip holds a ~2.6s reveal beat after
    // match.end (holdResultMs — bumped from 1.5s so the win/lose bar never lights before the 3D
    // coin's longer ~1.8-2.4s flip visually lands, COINFLIP_COIN.md flag #2) before the result
    // phase; wait it out so PLAY is pressable.
    await waitFor(() => expect(screen.getByTestId('hub-play')).not.toBeDisabled(), {
      timeout: 3500,
    });
    return sock;
  }

  it('pressing PLAY after a finished Coinflip round wipes the pills as one unit — coin back to searching', async () => {
    const sock = await enterAndFinish('coinflip', COINFLIP_DONE);
    // The finished round shows both pick pills (own highlight + opponent's revealed pick).
    expect(await screen.findByTestId('coin-own-pick')).toBeInTheDocument();
    expect(screen.getByTestId('coin-opp-pick')).toBeInTheDocument();

    // PLAY again → the whole round view is wiped (not just the opponent name).
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(screen.queryByTestId('coin-own-pick')).toBeNull();
    expect(screen.queryByTestId('coin-opp-pick')).toBeNull();

    // …and the coin panel is back to searching.
    deliver(sock, 'queue.waiting', {
      gameId: 'coinflip',
      matchId: 'q2',
      since: 0,
      expiresAt: Date.now() + 90_000,
    });
    await waitFor(() => expect(screen.getByTestId('hub-waiting-countdown')).toBeInTheDocument());
  });

  it('leaving and re-entering the hub loads a clean idle page (no leftover pills)', async () => {
    await enterAndFinish('coinflip', COINFLIP_DONE);
    expect(await screen.findByTestId('coin-own-pick')).toBeInTheDocument();

    // Leave to the RPS hub, then back to Coinflip (both via the related rail).
    fireEvent.click(await screen.findByTestId('hub-related-rps'));
    fireEvent.click(await screen.findByTestId('hub-related-coinflip'));

    expect(screen.queryByTestId('coin-own-pick')).toBeNull();
    expect(screen.queryByTestId('coin-opp-pick')).toBeNull();
    // #262: the idle caption is gone — the board carries no text in any state.
    expect(screen.getByTestId('hub-board').textContent).toBe('');
  });

  it('the idle post-round result view PERSISTS between a finished round and the next PLAY/leave', async () => {
    await enterAndFinish('coinflip', COINFLIP_DONE);
    expect(await screen.findByTestId('coin-own-pick')).toBeInTheDocument();
    // Coinflip suppresses the overlay, so nothing auto-dismisses/wipes while the player sits there.
    await new Promise((r) => setTimeout(r, 150));
    expect(screen.getByTestId('coin-own-pick')).toBeInTheDocument();
    expect(screen.getByTestId('coin-opp-pick')).toBeInTheDocument();
  });

  it('the same wipe clears another game’s board remnants (Blackjack cards) on PLAY', async () => {
    await enterAndFinish('blackjack', BLACKJACK_DONE);
    // The finished hand persists on the board (Blackjack also suppresses the overlay).
    await waitFor(() =>
      expect(within(screen.getByTestId('own-hand')).getAllByTestId('card').length).toBeGreaterThan(
        0
      )
    );
    // PLAY again → the shared gameState wipe empties the board (back to the idle table, no cards).
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(screen.queryAllByTestId('card')).toHaveLength(0);
    expect(screen.queryByTestId('own-hand')).toBeNull();
  });

  // Bug 2: the search deadline is search-scoped — it must not outlive the match it resolved into and
  // re-arm the expiry effect, flashing "No opponent found" while the player idles on the finished round.
  it('a search deadline never survives its match: search → match → end → idle shows no "No opponent found"', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('home-hub')).toBeInTheDocument());
    const sock = sockets[0];
    act(() => {
      sock.readyState = 1;
      sock.onopen?.();
    });
    fireEvent.click(await screen.findByTestId('home-tile-coinflip'));
    fireEvent.click(await screen.findByTestId('hub-bet-10'));
    fireEvent.click(screen.getByTestId('hub-play'));
    // A real in-flight search with a SHORT server deadline…
    deliver(sock, 'queue.waiting', {
      gameId: 'coinflip',
      matchId: 'q1',
      since: 0,
      expiresAt: Date.now() + 150,
    });
    await waitFor(() => expect(screen.getByTestId('hub-waiting-countdown')).toBeInTheDocument());
    // …that resolves into a match, which then ENDS (match-start clears the stale deadline).
    deliver(sock, 'match.start', {
      matchId: 'm1',
      opponent: 'bob-id',
      gameId: 'coinflip',
      state: COINFLIP_DONE,
    });
    deliver(sock, 'match.end', {
      outcome: { type: 'win', winner: 'pid' },
      settlement: { delta: 19, newBalance: 1019 },
    });
    // holdResultMs bumped to 2.6s (COINFLIP_COIN.md flag #2 — see enterAndFinish above).
    await waitFor(() => expect(screen.getByTestId('hub-play')).not.toBeDisabled(), {
      timeout: 3500,
    });
    // Idle PAST the original 150 ms search deadline — the stale value must not re-arm the expiry.
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.getByTestId('hub-no-opponent').textContent ?? '').not.toContain(
      'No opponent found'
    );
  });
});

describe('App — guest mode never gets stuck on an uncurated hub (issue #283)', () => {
  // A guest got stuck on a Chess screen with no armed stake and a locked bet control — a dead
  // end. Root cause: HubRibbon's top-ribbon logo button was the ONE clickable element in the
  // guest hub chrome not gated on `isGuest` (every other exit — related-games rail, footer,
  // bottom nav, the wallet chip — already was). Tapping it called `onLogo` -> `goToHome` ->
  // the full, unrestricted Home hub, whose game grid has no concept of guest mode at all.
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
        url, readyState: 0, onopen: null, onmessage: null, onclose: null,
        send: vi.fn(), close: vi.fn(),
      };
      sockets.push(s);
      return s;
    });
    vi.stubGlobal('WebSocket', Object.assign(ctor, { OPEN: 1, CONNECTING: 0, CLOSING: 2, CLOSED: 3 }));
    // NO token → logged out, same as a fresh visitor picking "Play as guest".
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/open-challenges')) return { ok: true, json: async () => [] } as Response;
        if (u.includes('/auth/guest')) {
          return {
            ok: true,
            json: async () => ({
              token: 'GT', playerId: 'guest:G1', balance: 300,
              username: 'Guest', avatarId: 'default', isGuest: true,
            }),
          } as Response;
        }
        return { ok: true, json: async () => ({ balance: 300, entries: [] }) } as Response;
      })
    );
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  /** Land a fresh guest session on the curated Coinflip hub via the real "Play as guest" flow.
   *  Post-#279, guest-auth success lands on the guest game picker first (not directly in a hub) —
   *  pick the Coinflip tile to reach the same hub this suite's pre-#279 assertions exercise. */
  async function enterAsGuest() {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('home-hub')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('hub-signin-chip'));
    await waitFor(() => expect(screen.getByTestId('auth-modal')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('auth-guest'));
    await waitFor(() => expect(screen.getByTestId('guest-game-picker')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('guest-picker-coinflip'));
    await waitFor(() => expect(screen.getByTestId('hub-guest-badge')).toBeInTheDocument());
  }

  it('regression: the identified trigger (the top-ribbon logo) no longer routes a guest off their curated hub', async () => {
    await enterAsGuest();
    expect(screen.getByLabelText('Coinflip')).toBeInTheDocument(); // on the curated hub

    // The fix: for a guest the logo is a plain, non-interactive image — no enclosing <button>,
    // no aria-label, no onClick. Pre-fix, this exact click landed on the Home hub's unrestricted
    // game grid, from which any tile reached a hub with no stake pre-armed and a locked control.
    expect(screen.queryByLabelText('RapidClash — home')).toBeNull();
    fireEvent.click(screen.getByAltText('RapidClash'));

    // Still on the guest's curated Coinflip hub — never routed to Home.
    expect(screen.getByLabelText('Coinflip')).toBeInTheDocument();
    expect(screen.queryByTestId('home-hub')).toBeNull();
    // And still playable — not the dead end from the bug report.
    expect(screen.getByTestId(`hub-bet-${GUEST_COINFLIP_STAKE}`)).toBeInTheDocument();
  });

  it('defense-in-depth: whatever the trigger, a guest who lands on an uncurated hub is snapped back to their curated entry — never a dead end', async () => {
    await enterAsGuest();
    const sock = sockets[0];

    // Independent of the specific bug found/fixed above: simulate a guest somehow reaching a
    // match.start for a game outside GUEST_CURATED_GAMES (today Coinflip + Chess; 'rps' is not
    // curated) — the "whatever the trigger" scenario the App-level guard exists for, exercised
    // through a different injection point (the WS message handler, not the ribbon click) than the
    // fix above.
    const env = {
      type: 'match.start',
      matchId: 'm1',
      payload: {
        matchId: 'm1', opponent: 'bob', opponentName: 'Bob', gameId: 'rps',
        state: { players: ['guest:G1', 'bob'], choices: {} },
      },
    };
    act(() => { sock.onmessage?.({ data: JSON.stringify(env) }); });

    // The guard (isGuest on a hub screen outside GUEST_CURATED_GAMES) fires and snaps back —
    // never left sitting on the uncurated RPS hub.
    await waitFor(() => expect(screen.getByLabelText('Coinflip')).toBeInTheDocument());
    expect(screen.queryByTestId('hub-move-rock')).toBeNull(); // the RPS board never stuck around
    // Back on a genuinely playable screen — a fresh stake is armed, not a locked, empty control.
    expect(screen.getByTestId(`hub-bet-${GUEST_COINFLIP_STAKE}`)).toBeInTheDocument();
  });
});
