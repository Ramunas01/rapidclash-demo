// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../App.js';
import { balancesOf } from './testBalances.js';

// The Coinflip hub's coin is a real Three.js cylinder; jsdom has no WebGL context.
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
  window.history.pushState({}, '', '/');
});

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

// Ticket 2026-10-01#7: the hidden `?mode=admin` entry point — Owner-confirmed a hidden route
// over a nav entry. This alone never grants access; it only makes the app route to the admin
// screen once/if the signed-in session's own `role` is genuinely `'admin'` (server-side
// `requireAdmin` is the real authorization boundary, confirmed separately in admin.test.ts).
describe('App — ?mode=admin URL entry point (ticket 2026-10-01#7)', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  function stubFetch(role: 'player' | 'admin') {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/auth/register')) {
          return {
            ok: true,
            json: async () => ({ token: 'T', playerId: 'P1', balances: balancesOf(1000), username: 'tester', avatarId: 'default', role }),
          } as Response;
        }
        if (u.includes('/admin/players')) return { ok: true, json: async () => [] } as Response;
        if (u.includes('/open-challenges')) return { ok: true, json: async () => [] } as Response;
        return { ok: true, json: async () => ({ balances: balancesOf(1000), entries: [] }) } as Response;
      }),
    );
  }

  it('a non-admin account signing in under ?mode=admin lands on Home, never the admin screen', async () => {
    window.history.pushState({}, '', '/?mode=admin');
    stubFetch('player');
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('home-hub')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('hub-signin-chip'));
    await waitFor(() => expect(screen.getByTestId('auth-modal')).toHaveAttribute('aria-hidden', 'false'));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'tester' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('auth-submit'));

    await waitFor(() => expect(screen.getByTestId('home-hub')).toBeInTheDocument());
    expect(screen.queryByTestId('admin-players-table')).toBeNull();
  });

  it('an admin account signing in under ?mode=admin lands directly on the admin screen', async () => {
    window.history.pushState({}, '', '/?mode=admin');
    stubFetch('admin');
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('home-hub')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('hub-signin-chip'));
    await waitFor(() => expect(screen.getByTestId('auth-modal')).toHaveAttribute('aria-hidden', 'false'));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('auth-submit'));

    await waitFor(() => expect(screen.getByTestId('admin-players-table')).toBeInTheDocument());
  });

  it('a reload with an already-persisted admin session under ?mode=admin restores straight to the admin screen', async () => {
    localStorage.setItem('rc_token', 'T');
    localStorage.setItem('rc_playerId', 'P1');
    localStorage.setItem('rc_username', 'admin');
    localStorage.setItem('rc_role', 'admin');
    window.history.pushState({}, '', '/?mode=admin');
    stubFetch('admin');

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('admin-players-table')).toBeInTheDocument());
  });

  it('a reload with a persisted PLAYER (non-admin) session under ?mode=admin lands on Home, not admin', async () => {
    localStorage.setItem('rc_token', 'T');
    localStorage.setItem('rc_playerId', 'P1');
    localStorage.setItem('rc_username', 'tester');
    localStorage.setItem('rc_role', 'player');
    window.history.pushState({}, '', '/?mode=admin');
    stubFetch('player');

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('home-hub')).toBeInTheDocument());
    expect(screen.queryByTestId('admin-players-table')).toBeNull();
  });

  it('visiting ?mode=admin with no session at all lands on the ordinary logged-out Home — no crash, no admin screen', async () => {
    window.history.pushState({}, '', '/?mode=admin');
    stubFetch('player');
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('home-hub')).toBeInTheDocument());
    expect(screen.queryByTestId('admin-players-table')).toBeNull();
  });
});
