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

    // The persisted alias is shown on the wallet without any login round-trip.
    await waitFor(() => {
      expect(screen.getByTestId('signed-in-as').textContent).toBe('Signed in as alice');
    });

    fireEvent.click(screen.getByText('Sign out'));

    // Logout drops the stored alias in lockstep with the token/playerId…
    expect(localStorage.getItem('rc_username')).toBeNull();
    expect(localStorage.getItem('rc_token')).toBeNull();
    expect(localStorage.getItem('rc_playerId')).toBeNull();
    // …and we are back on the auth screen.
    expect(screen.getByText('Create Account')).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByTestId('signed-in-as')).toBeInTheDocument());

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
