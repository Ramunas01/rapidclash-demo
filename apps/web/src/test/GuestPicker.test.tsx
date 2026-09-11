// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { App } from '../App.js';

// The Coinflip hub's coin is a real Three.js cylinder; jsdom has no WebGL context (mirrors App.test.tsx).
vi.mock('three', async () => import('./three-stub.js'));

// The events emitter (issue #271) is exercised on its own in guestEvents.test.ts — here we only
// need to know WHETHER App called emitFirstWin, not re-verify its internal origin/one-shot logic.
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

describe('App — guest game picker (issue #279)', () => {
  let sockets: MockSock[];

  beforeEach(() => {
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

  it('a guest lands on the picker (not directly in a hub), showing the real GUEST_CURATED_GAMES — now genuinely Coinflip + Chess + Blackjack (#278, #297 merged)', async () => {
    await enterAsGuest();
    expect(screen.getByTestId('guest-picker-coinflip')).toBeInTheDocument();
    // All three tiles come from the real, unmocked GUEST_CURATED_GAMES — see
    // GuestPickerChess.test.tsx / GuestPickerBlackjack.test.tsx for the dedicated proof this is
    // genuinely data-driven, not a hardcoded set.
    expect(screen.queryAllByTestId(/^guest-picker-/)).toHaveLength(3);
  });

  it('picking Coinflip lands on the guest coinflip hub, pre-armed at the default stake but genuinely interactive (issue #353)', async () => {
    await enterAsGuest();
    fireEvent.click(screen.getByTestId('guest-picker-coinflip'));

    await waitFor(() => expect(screen.getByTestId('hub-guest-badge')).toBeInTheDocument());
    // Pre-armed at GUEST_COINFLIP_STAKE by default (a guest who never touches the control), but no
    // longer locked — the preset is enabled and re-selectable, not disabled/inert.
    expect(screen.getByTestId('hub-bet-100')).not.toBeDisabled();
    expect(screen.queryByTestId('hub-wallet-chip')).toBeNull(); // guest chrome still applies
  });

  it('GUEST_HUMAN_RESERVED_STAKE (1) is withheld from a guest coinflip bet grid entirely — never rendered as an option (issue #353)', async () => {
    await enterAsGuest();
    fireEvent.click(screen.getByTestId('guest-picker-coinflip'));
    await waitFor(() => expect(screen.getByTestId('hub-guest-badge')).toBeInTheDocument());

    expect(screen.queryByTestId('hub-bet-1')).toBeNull();
  });

  it('a guest can re-arm a non-default, non-reserved stake and post it (issue #353)', async () => {
    await enterAsGuest();
    fireEvent.click(screen.getByTestId('guest-picker-coinflip'));
    await waitFor(() => expect(screen.getByTestId('hub-guest-badge')).toBeInTheDocument());

    // Re-arm away from the GUEST_COINFLIP_STAKE (100) default onto a different offered preset.
    // Ticket 2026-09-11#8/A item 2: selection is now the shared sliding indicator, not a
    // per-button `bg-brand` class — `aria-pressed` is the selection signal post-restructure.
    fireEvent.click(screen.getByTestId('hub-bet-25'));
    expect(screen.getByTestId('hub-bet-25')).toHaveAttribute('aria-pressed', 'true');

    openSocket(sockets[0]);
    fireEvent.click(screen.getByTestId('hub-play'));
    const joins = sockets[0].send.mock.calls
      .map((c) => JSON.parse(String(c[0])))
      .filter((m: { type: string }) => m.type === 'queue.join');
    expect(joins).toHaveLength(1);
    expect(joins[0].payload).toMatchObject({ gameId: 'coinflip', stake: 25 });
  });

  it('`ready` fires once the guest surface (the picker) is up — not gated on a specific hub screen', async () => {
    const { emitReady } = await import('../guest/events.js');
    await enterAsGuest();
    await waitFor(() => expect(emitReady).toHaveBeenCalled());
  });

  it('the resize ResizeObserver keeps targeting #root across the picker → hub transition (no unmount)', async () => {
    // RTL's render() mounts into an arbitrary container (no id) — real production main.tsx renders
    // into index.html's literal `<div id="root">`. Recreate that one detail so the App's own
    // `document.getElementById('root')` lookup (unchanged by this ticket) has something to find.
    const rootDiv = document.createElement('div');
    rootDiv.id = 'root';
    document.body.appendChild(rootDiv);

    const observed: Element[] = [];
    class FakeResizeObserver {
      constructor(private cb: ResizeObserverCallback) {}
      observe(el: Element) { observed.push(el); }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver as unknown as typeof ResizeObserver);

    render(<App />, { container: rootDiv });
    await waitFor(() => screen.getByTestId('home-hub'));
    fireEvent.click(screen.getByTestId('hub-signin-chip'));
    await waitFor(() => screen.getByTestId('auth-guest'));
    fireEvent.click(screen.getByTestId('auth-guest'));
    await waitFor(() => screen.getByTestId('guest-game-picker'));

    expect(observed).toContain(rootDiv);

    fireEvent.click(screen.getByTestId('guest-picker-coinflip'));
    await waitFor(() => expect(screen.getByTestId('hub-guest-badge')).toBeInTheDocument());
    // #root is the persistent React mount point — screens are content swapped inside it, never a
    // remount of #root itself, so the SAME node is still there (and still the one being observed)
    // after the picker → hub transition.
    expect(document.getElementById('root')).toBe(rootDiv);
  });

  it('a guest Coinflip win fires firstWin exactly once (game-agnostic condition, existing #271 behavior — regression guard)', async () => {
    await enterAsGuest();
    fireEvent.click(screen.getByTestId('guest-picker-coinflip'));
    await waitFor(() => expect(screen.getByTestId('hub-guest-badge')).toBeInTheDocument());

    const sock = sockets[0];
    openSocket(sock);
    deliver(sock, 'match.start', { matchId: 'm1', opponent: 'demo-bot:coinflip', gameId: 'coinflip', state: { players: ['guest:G1', 'demo-bot:coinflip'], choices: {} } });
    deliver(sock, 'match.end', { outcome: { type: 'win', winner: 'guest:G1' }, settlement: { delta: 100, newBalance: 400 } }, 'm1');

    await waitFor(() => expect(emitFirstWinMock).toHaveBeenCalledTimes(1));
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
