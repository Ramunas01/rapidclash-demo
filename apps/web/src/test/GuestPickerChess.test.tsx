// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { App } from '../App.js';

// #278 has now merged: GUEST_CURATED_GAMES is genuinely ['coinflip', 'chess'] on `packages/shared`
// (no mock). These tests exercise the real constant end-to-end, proving the picker/routing/
// pre-arm/firstWin wiring is genuinely data-driven (issue #279), not a second hardcoded path that
// happens to also handle chess.
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

describe('App — guest game picker with Chess curated (issue #279, real GUEST_CURATED_GAMES post-#278)', () => {
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
        // Guest sessions never call /games (GameHub skips the roster fetch for isGuest) — if this
        // DID get called and returned chess without a timeControl, it would expose the exact bug
        // #279 fixes, so leaving it wallet-shaped here is a deliberate trap, not an oversight.
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

  it('the picker shows BOTH curated games — proves it is genuinely data-driven off GUEST_CURATED_GAMES, not a second hardcoded path', async () => {
    await enterAsGuest();
    expect(screen.getByTestId('guest-picker-coinflip')).toBeInTheDocument();
    expect(screen.getByTestId('guest-picker-chess')).toBeInTheDocument();
  });

  it('picking Chess lands in the chess hub with the stake AND blitz5 pre-armed — no time-control picker, but the bet grid is genuinely interactive (issue #353)', async () => {
    await enterAsGuest();
    fireEvent.click(screen.getByTestId('guest-picker-chess'));

    await waitFor(() => expect(screen.getByTestId('hub-guest-badge')).toBeInTheDocument());
    expect(screen.getByTestId('chess-board')).toBeInTheDocument();
    expect(screen.getByTestId('hub-bet-100')).not.toBeDisabled(); // pre-armed default, no longer locked
    expect(screen.queryByTestId('hub-bet-1')).toBeNull(); // GUEST_HUMAN_RESERVED_STAKE withheld entirely
    expect(screen.queryByTestId('hub-section-timecontrol')).toBeNull(); // no picker shown, ever

    openSocket(sockets[0]);
    fireEvent.click(screen.getByTestId('hub-play'));
    const joins = sockets[0].send.mock.calls
      .map((c) => JSON.parse(String(c[0])))
      .filter((m: { type: string }) => m.type === 'queue.join');
    expect(joins).toHaveLength(1);
    expect(joins[0].payload).toMatchObject({ gameId: 'chess', stake: 100, timeControlId: 'blitz5' });
  });

  it('a guest can re-arm Chess to a non-default, non-reserved stake and post it, keeping the pre-armed time control (issue #353)', async () => {
    await enterAsGuest();
    fireEvent.click(screen.getByTestId('guest-picker-chess'));
    await waitFor(() => expect(screen.getByTestId('hub-guest-badge')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('hub-bet-10'));
    openSocket(sockets[0]);
    fireEvent.click(screen.getByTestId('hub-play'));
    const joins = sockets[0].send.mock.calls
      .map((c) => JSON.parse(String(c[0])))
      .filter((m: { type: string }) => m.type === 'queue.join');
    expect(joins).toHaveLength(1);
    expect(joins[0].payload).toMatchObject({ gameId: 'chess', stake: 10, timeControlId: 'blitz5' });
  });

  it('a guest CHESS win fires firstWin exactly once — the game-agnostic #271 condition genuinely covers chess, not just Coinflip', async () => {
    await enterAsGuest();
    fireEvent.click(screen.getByTestId('guest-picker-chess'));
    await waitFor(() => expect(screen.getByTestId('hub-guest-badge')).toBeInTheDocument());

    const sock = sockets[0];
    openSocket(sock);
    deliver(sock, 'match.start', { matchId: 'm1', opponent: 'demo-bot:chess:0', gameId: 'chess', state: { players: ['guest:G1', 'demo-bot:chess:0'] } });
    deliver(sock, 'match.end', { outcome: { type: 'win', winner: 'guest:G1' }, settlement: { delta: 100, newBalance: 400 } }, 'm1');

    await waitFor(() => expect(emitFirstWinMock).toHaveBeenCalledTimes(1));
    expect(emitFirstWinMock).toHaveBeenCalledWith(); // no payload — no PII (issue #271's requirement, unaffected by this ticket)
  });

  it('a guest CHESS loss does NOT fire firstWin (sanity — the condition is outcome-specific, not just game-specific)', async () => {
    await enterAsGuest();
    fireEvent.click(screen.getByTestId('guest-picker-chess'));
    await waitFor(() => expect(screen.getByTestId('hub-guest-badge')).toBeInTheDocument());

    const sock = sockets[0];
    openSocket(sock);
    deliver(sock, 'match.start', { matchId: 'm1', opponent: 'demo-bot:chess:0', gameId: 'chess', state: { players: ['guest:G1', 'demo-bot:chess:0'] } });
    deliver(sock, 'match.end', { outcome: { type: 'win', winner: 'demo-bot:chess:0' }, settlement: { delta: -100, newBalance: 200 } }, 'm1');

    await waitFor(() => expect(screen.getByTestId('chess-result-popup')).toBeInTheDocument());
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
