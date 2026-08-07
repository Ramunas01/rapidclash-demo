// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../App.js';

// The Coinflip hub's coin is a real Three.js cylinder; jsdom has no WebGL context (mirrors App.test.tsx).
vi.mock('three', async () => import('./three-stub.js'));

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
  // Reset the URL to the bare origin before every test — each test sets its own via pushState.
  window.history.pushState({}, '', '/');
});

// jsdom has no WebSocket; a minimal stand-in (mirrors App.test.tsx).
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

describe('App — ?mode=guest URL entry point (issue #284)', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  function stubGuestAuthFetch() {
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
        return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
      }),
    );
  }

  it('visiting ?mode=guest with no interaction lands on the guest surface — no home-hub flash first', async () => {
    window.history.pushState({}, '', '/?mode=guest');
    stubGuestAuthFetch();

    render(<App />);
    // Synchronously (before the async guest-auth call resolves) — the blank loading screen, NOT Home.
    expect(screen.getByTestId('guest-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('home-hub')).toBeNull();

    // The guest surface lands once the mint resolves — no auth wall, no tap. Post-#279,
    // handleGuestSuccess (called verbatim by this URL-entry path) lands on the guest game
    // picker rather than jumping straight into a hub — the picker itself IS the guest surface.
    await waitFor(() => expect(screen.getByTestId('guest-game-picker')).toBeInTheDocument());
    expect(screen.queryByTestId('auth-modal')).toBeNull();
    expect(screen.queryByTestId('home-hub')).toBeNull(); // never rendered at any point
  });

  it('a plain load with no query param is completely unaffected (regression guard)', async () => {
    stubGuestAuthFetch();
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('home-hub')).toBeInTheDocument());
    expect(screen.queryByTestId('guest-loading')).toBeNull();
    expect(screen.queryByTestId('hub-guest-badge')).toBeNull();
  });

  it('the existing "Play as guest" button flow is unchanged (regression guard)', async () => {
    stubGuestAuthFetch();
    render(<App />);
    await waitFor(() => screen.getByTestId('home-hub'));

    fireEvent.click(screen.getByTestId('hub-signin-chip'));
    await waitFor(() => screen.getByTestId('auth-guest'));
    fireEvent.click(screen.getByTestId('auth-guest'));

    // Lands on the guest picker (issue #279), same as the ?mode=guest URL-entry path above —
    // both drive the same handleGuestSuccess. A hub only follows a tile pick.
    await waitFor(() => expect(screen.getByTestId('guest-game-picker')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('guest-picker-coinflip'));
    await waitFor(() => expect(screen.getByTestId('hub-guest-badge')).toBeInTheDocument());
  });

  it('an already-signed-in visitor is never hijacked by ?mode=guest — lands on their own session, no guest-auth call', async () => {
    window.history.pushState({}, '', '/?mode=guest');
    localStorage.setItem('rc_token', 'real-tok');
    localStorage.setItem('rc_playerId', 'real-pid');
    localStorage.setItem('rc_username', 'alice');
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('home-hub')).toBeInTheDocument());
    expect(screen.queryByTestId('hub-guest-badge')).toBeNull();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/auth/guest'))).toBe(false);
  });

  it('a failed guest-auth call falls back to the normal Home hub instead of a stuck loading screen', async () => {
    window.history.pushState({}, '', '/?mode=guest');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/auth/guest')) return { ok: false, status: 500, json: async () => ({ error: 'boom' }) } as Response;
        return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<App />);
    expect(screen.getByTestId('guest-loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('home-hub')).toBeInTheDocument());
  });
});
