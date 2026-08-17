// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { App } from '../App.js';
import { UNTIMED_TIME_CONTROL } from '@rapidclash/shared';

// Issue #297 (Blackjack Demo-Opponent) mirrors GuestPickerChess.test.tsx's structure: exercises
// the REAL, unmocked `GUEST_CURATED_GAMES` (now ['coinflip', 'chess', 'blackjack']) end-to-end —
// same "no more mocking a constant that's real" bar PR #281 held Chess's version of this suite to.
vi.mock('three', async () => import('./three-stub.js'));

const { emitFirstWinMock } = vi.hoisted(() => ({ emitFirstWinMock: vi.fn() }));
vi.mock('../guest/events.js', () => ({
  initGuestEvents: () => () => {},
  emitReady: vi.fn(),
  emitResize: vi.fn(),
  emitRequestFullscreenOnMobileEntry: vi.fn(),
  emitFirstWin: emitFirstWinMock,
}));

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
    (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number,
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  emitFirstWinMock.mockClear();
});

type MockSock = {
  url: string;
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: (() => void) | null;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

describe('App — guest game picker with Blackjack curated (issue #297, real GUEST_CURATED_GAMES post-#297)', () => {
  let sockets: MockSock[];

  beforeEach(async () => {
    sockets = [];
    const ctor = vi.fn((url: string) => {
      const s: MockSock = { url, readyState: 0, onopen: null, onmessage: null, onclose: null, send: vi.fn(), close: vi.fn() };
      sockets.push(s);
      return s;
    });
    vi.stubGlobal('WebSocket', Object.assign(ctor, { OPEN: 1, CONNECTING: 0, CLOSING: 2, CLOSED: 3 }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/auth/guest')) {
          return {
            ok: true,
            json: async () => ({ token: 'GT', playerId: 'guest:G1', balance: 300, username: 'Guest', avatarId: 'default', isGuest: true }),
          } as Response;
        }
        if (u.includes('/open-challenges')) return { ok: true, json: async () => [] } as Response;
        // Guest sessions never call /games (GameHub skips the roster fetch for isGuest) — leaving
        // this wallet-shaped is a deliberate trap for any regression that reintroduces the fetch.
        return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
      }),
    );
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  async function enterAsGuest() {
    render(<App />);
    await waitFor(() => screen.getByTestId('home-hub'));
    fireEvent.click(screen.getByTestId('hub-signin-chip'));
    await waitFor(() => screen.getByTestId('auth-guest'));
    fireEvent.click(screen.getByTestId('auth-guest'));
    await waitFor(() => screen.getByTestId('guest-game-picker'));
  }

  it('the picker shows ALL THREE curated games — proves it is genuinely data-driven off GUEST_CURATED_GAMES, not a second hardcoded path', async () => {
    await enterAsGuest();
    expect(screen.getByTestId('guest-picker-coinflip')).toBeInTheDocument();
    expect(screen.getByTestId('guest-picker-chess')).toBeInTheDocument();
    expect(screen.getByTestId('guest-picker-blackjack')).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^guest-picker-/)).toHaveLength(3);
  });

  it('picking Blackjack lands in the blackjack hub with the default stake pre-armed but genuinely interactive — no time-control concept (issue #353)', async () => {
    await enterAsGuest();
    fireEvent.click(screen.getByTestId('guest-picker-blackjack'));

    await waitFor(() => expect(screen.getByTestId('hub-guest-badge')).toBeInTheDocument());
    expect(screen.getByTestId('hub-bet-100')).not.toBeDisabled(); // pre-armed default, no longer locked
    expect(screen.queryByTestId('hub-bet-1')).toBeNull(); // GUEST_HUMAN_RESERVED_STAKE withheld entirely
    expect(screen.queryByTestId('hub-section-timecontrol')).toBeNull(); // Blackjack has no time-control concept

    openSocket(sockets[0]);
    fireEvent.click(screen.getByTestId('hub-play'));
    const joins = sockets[0].send.mock.calls
      .map((c) => JSON.parse(String(c[0])))
      .filter((m: { type: string }) => m.type === 'queue.join');
    expect(joins).toHaveLength(1);
    expect(joins[0].payload).toMatchObject({ gameId: 'blackjack', stake: 100 });
    // ws.ts's joinQueue defaults an unset timeControlId to the shared UNTIMED sentinel — Blackjack
    // never sets `guestTimeControl` (App.tsx, unlike Chess), so this is what actually crosses the
    // wire; the real proof of "no time-control picker" is the UI assertion above, not this value.
    expect(joins[0].payload.timeControlId).toBe(UNTIMED_TIME_CONTROL);
  });

  it('a guest can re-arm Blackjack to a non-default, non-reserved stake and post it (issue #353)', async () => {
    await enterAsGuest();
    fireEvent.click(screen.getByTestId('guest-picker-blackjack'));
    await waitFor(() => expect(screen.getByTestId('hub-guest-badge')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('hub-bet-50'));
    openSocket(sockets[0]);
    fireEvent.click(screen.getByTestId('hub-play'));
    const joins = sockets[0].send.mock.calls
      .map((c) => JSON.parse(String(c[0])))
      .filter((m: { type: string }) => m.type === 'queue.join');
    expect(joins).toHaveLength(1);
    expect(joins[0].payload).toMatchObject({ gameId: 'blackjack', stake: 50 });
  });

  it('a guest BLACKJACK win fires firstWin exactly once — the game-agnostic #271 condition genuinely covers blackjack, not just Coinflip/Chess', async () => {
    await enterAsGuest();
    fireEvent.click(screen.getByTestId('guest-picker-blackjack'));
    await waitFor(() => expect(screen.getByTestId('hub-guest-badge')).toBeInTheDocument());

    const sock = sockets[0];
    openSocket(sock);
    deliver(sock, 'match.start', {
      matchId: 'm1',
      opponent: 'demo-bot:blackjack:0',
      gameId: 'blackjack',
      state: {
        players: ['guest:G1', 'demo-bot:blackjack:0'],
        round: 0,
        draws: 0,
        hands: {
          'guest:G1': { cards: [{ rank: '10', suit: '♠' }, { rank: '9', suit: '♥' }], done: false },
          'demo-bot:blackjack:0': { cards: [{ rank: 'K', suit: '♣' }], done: false },
        },
      },
    });
    // A real server always broadcasts the terminal match.state (both hands revealed, `winner` set
    // — BlackjackHubScreen's own reveal choreography keys off `winner`/`forcedOutcome` being
    // present, `isTerminalView`) BEFORE match.end — mirror that here rather than jumping straight
    // to match.end, which would leave the hub's reveal hold waiting on a terminal frame it never saw.
    deliver(sock, 'match.state', {
      state: {
        players: ['guest:G1', 'demo-bot:blackjack:0'],
        round: 0,
        draws: 0,
        winner: 'guest:G1',
        hands: {
          'guest:G1': { cards: [{ rank: '10', suit: '♠' }, { rank: '9', suit: '♥' }], done: true },
          'demo-bot:blackjack:0': { cards: [{ rank: 'K', suit: '♣' }, { rank: '5', suit: '♦' }], done: true },
        },
      },
      events: [{ type: 'round_revealed', payload: {} }],
    }, 'm1');
    deliver(sock, 'match.end', { outcome: { type: 'win', winner: 'guest:G1' }, settlement: { delta: 100, newBalance: 400 } }, 'm1');

    await waitFor(() => expect(emitFirstWinMock).toHaveBeenCalledTimes(1));
    expect(emitFirstWinMock).toHaveBeenCalledWith(); // no payload — no PII (issue #271's requirement, unaffected by this ticket)
  });

  it('a guest BLACKJACK loss does NOT fire firstWin (sanity — the condition is outcome-specific, not just game-specific)', async () => {
    await enterAsGuest();
    fireEvent.click(screen.getByTestId('guest-picker-blackjack'));
    await waitFor(() => expect(screen.getByTestId('hub-guest-badge')).toBeInTheDocument());

    const sock = sockets[0];
    openSocket(sock);
    deliver(sock, 'match.start', {
      matchId: 'm1',
      opponent: 'demo-bot:blackjack:0',
      gameId: 'blackjack',
      state: {
        players: ['guest:G1', 'demo-bot:blackjack:0'],
        round: 0,
        draws: 0,
        hands: {
          'guest:G1': { cards: [{ rank: '10', suit: '♠' }, { rank: '6', suit: '♥' }], done: false },
          'demo-bot:blackjack:0': { cards: [{ rank: 'K', suit: '♣' }], done: false },
        },
      },
    });
    // Same reasoning as the win test above: a real server's terminal match.state precedes match.end.
    deliver(sock, 'match.state', {
      state: {
        players: ['guest:G1', 'demo-bot:blackjack:0'],
        round: 0,
        draws: 0,
        winner: 'demo-bot:blackjack:0',
        hands: {
          'guest:G1': { cards: [{ rank: '10', suit: '♠' }, { rank: '6', suit: '♥' }], done: true },
          'demo-bot:blackjack:0': { cards: [{ rank: 'K', suit: '♣' }, { rank: '9', suit: '♦' }], done: true },
        },
      },
      events: [{ type: 'round_revealed', payload: {} }],
    }, 'm1');
    deliver(sock, 'match.end', { outcome: { type: 'win', winner: 'demo-bot:blackjack:0' }, settlement: { delta: -100, newBalance: 200 } }, 'm1');

    // Blackjack's reveal choreography holds the pre-settlement balance/verdict on screen for a
    // beat (BLACKJACK.md's continuous reveal scene) before the settled balance applies — allow it
    // real time to complete rather than asserting instantly.
    await waitFor(() => expect(screen.getByTestId('hub-balance')).toHaveTextContent('200'), { timeout: 3000 });
    expect(emitFirstWinMock).not.toHaveBeenCalled();
  });
});

function openSocket(sock: MockSock) {
  act(() => {
    sock.readyState = 1;
    sock.onopen?.();
  });
}

function deliver(sock: MockSock, type: string, payload: unknown, matchId?: string) {
  act(() => {
    sock.onmessage?.({ data: JSON.stringify({ type, payload, ...(matchId ? { matchId } : {}) }) });
  });
}
