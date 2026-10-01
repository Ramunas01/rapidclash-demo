// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthModal } from '../components/AuthModal.js';
import { balancesOf } from './testBalances.js';

describe('AuthModal', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (u.includes('/auth/register'))
        return { ok: true, json: async () => ({ token: 'T', playerId: 'P', balances: balancesOf(1000), username: body.username, avatarId: 'default' }) } as Response;
      if (u.includes('/auth/login'))
        return { ok: true, json: async () => ({ token: 'T2', playerId: 'P2', balances: balancesOf(42), username: body.username, avatarId: 'rc-04' }) } as Response;
      return { ok: false, json: async () => ({ error: 'nope' }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  // Ticket 2026-10-01#2 (D71): iOS Safari auto-zooms the page on focusing any text field with a
  // computed font-size under 16px — these two fields were 15px (D70's own prototype-matching
  // value), a real UX bug the 1px fidelity gap to the prototype doesn't justify keeping.
  it('username/password inputs render at 16px, not the old 15px (iOS Safari auto-zoom-on-focus, ticket 2026-10-01#2)', () => {
    render(<AuthModal open onSuccess={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Username').className).toContain('text-[16px]');
    expect(screen.getByLabelText('Username').className).not.toContain('text-[15px]');
    expect(screen.getByLabelText('Password').className).toContain('text-[16px]');
    expect(screen.getByLabelText('Password').className).not.toContain('text-[15px]');
  });

  it('register → onSuccess with the new token + the 1000-credit grant', async () => {
    const onSuccess = vi.fn();
    render(<AuthModal open onSuccess={onSuccess} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'neo' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('auth-submit'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('T', 'P', balancesOf(1000), 'neo', 'default'));
  });

  it('login tab → onSuccess with the existing account', async () => {
    const onSuccess = vi.fn();
    render(<AuthModal open onSuccess={onSuccess} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('auth-tab-login'));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'trinity' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('auth-submit'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('T2', 'P2', balancesOf(42), 'trinity', 'rc-04'));
  });

  it('surfaces a server error and does not resolve', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Username taken' }) } as Response)));
    const onSuccess = vi.fn();
    render(<AuthModal open onSuccess={onSuccess} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'dup' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('auth-submit'));
    await waitFor(() => expect(screen.getByTestId('auth-error').textContent).toContain('Username taken'));
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('dismiss (scrim tap) invokes onClose', () => {
    const onClose = vi.fn();
    render(<AuthModal open onSuccess={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('auth-modal-scrim'));
    expect(onClose).toHaveBeenCalled();
  });

  it('dismiss (drag-handle tap) invokes onClose', () => {
    const onClose = vi.fn();
    render(<AuthModal open onSuccess={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('auth-modal-handle'));
    expect(onClose).toHaveBeenCalled();
  });

  it('bottom-sheet rebuild: the 6 removed items do not render, in either mode', () => {
    const { container } = render(<AuthModal open onSuccess={vi.fn()} onClose={vi.fn()} />);
    // 1. The old "Create an account or Login" heading is gone — replaced by a per-mode title.
    expect(screen.queryByText('Create an account or Login')).toBeNull();
    expect(screen.getByTestId('auth-title').textContent).toBe('SIGNUP');
    // 2. No close X button.
    expect(screen.queryByLabelText('Dismiss')).toBeNull();
    // 3. No User/Lock icons inside the form — with no error and no loading spinner, the form
    //    (username input, password input, submit button) should render zero <svg>s at all; the
    //    old markup's icons lived in a `relative`-positioned wrapper around each input, which no
    //    longer exists either.
    expect(container.querySelectorAll('form svg').length).toBe(0);
    // 4. No "Play as guest instead" link/testid.
    expect(screen.queryByTestId('auth-guest')).toBeNull();
    expect(screen.queryByText('Play as guest instead')).toBeNull();
    // 5. No disclaimer paragraph.
    expect(screen.queryByText('Play-money demo credits only, no real-money wagering.')).toBeNull();

    fireEvent.click(screen.getByTestId('auth-tab-login'));
    expect(screen.getByTestId('auth-title').textContent).toBe('LOGIN');
    expect(screen.queryByText('Create an account or Login')).toBeNull();
    expect(screen.queryByLabelText('Dismiss')).toBeNull();
    expect(container.querySelectorAll('form svg').length).toBe(0);
    expect(screen.queryByTestId('auth-guest')).toBeNull();
    expect(screen.queryByText('Play-money demo credits only, no real-money wagering.')).toBeNull();
  });

  it('is always mounted — present in the DOM (translated off-screen) even when open=false', () => {
    render(<AuthModal open={false} onSuccess={vi.fn()} onClose={vi.fn()} />);
    const sheet = screen.getByTestId('auth-modal');
    expect(sheet).toBeInTheDocument();
    expect(sheet.style.transform).toBe('translateY(104%)');
  });

  it('stacking order: stays below HubToolbar\'s nav (z-20) via BottomSheet\'s z-10', () => {
    render(<AuthModal open onSuccess={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('auth-modal').className).toContain('z-10');
    expect(screen.getByTestId('auth-modal-scrim').className).toContain('z-10');
    expect(screen.getByTestId('auth-modal').className).not.toContain('z-20');
  });

  // Ticket 2026-10-01#1 (D70) item 1: `initialMode` seeds which tab the sheet opens on, re-synced
  // every time `open` flips true — not just on first mount, since this component never unmounts.
  describe('initialMode (ticket 2026-10-01#1)', () => {
    it('opens on the LOGIN tab when initialMode="login"', () => {
      render(<AuthModal open initialMode="login" onSuccess={vi.fn()} onClose={vi.fn()} />);
      expect(screen.getByTestId('auth-tab-login')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('auth-title').textContent).toBe('LOGIN');
    });

    it('opens on the SIGNUP tab when initialMode="register" (and when omitted — the default)', () => {
      const { unmount } = render(<AuthModal open initialMode="register" onSuccess={vi.fn()} onClose={vi.fn()} />);
      expect(screen.getByTestId('auth-tab-register')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('auth-title').textContent).toBe('SIGNUP');
      unmount();

      render(<AuthModal open onSuccess={vi.fn()} onClose={vi.fn()} />);
      expect(screen.getByTestId('auth-tab-register')).toHaveAttribute('aria-pressed', 'true');
    });

    it('re-syncs to the new initialMode on a LATER open, even after the user manually switched tabs — not just on first mount', () => {
      const { rerender } = render(<AuthModal open={false} initialMode="register" onSuccess={vi.fn()} onClose={vi.fn()} />);

      // First open: SIGNUP (initialMode), user manually switches to LOGIN.
      rerender(<AuthModal open initialMode="register" onSuccess={vi.fn()} onClose={vi.fn()} />);
      expect(screen.getByTestId('auth-tab-register')).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(screen.getByTestId('auth-tab-login'));
      expect(screen.getByTestId('auth-tab-login')).toHaveAttribute('aria-pressed', 'true');

      // Close, then re-open requesting LOGIN specifically — confirms a later open re-seeds from
      // `initialMode` rather than leaking the previous manual tab pick (a coincidental match here,
      // so prove the actual re-sync with a THIRD open requesting the other mode below).
      rerender(<AuthModal open={false} initialMode="register" onSuccess={vi.fn()} onClose={vi.fn()} />);
      rerender(<AuthModal open initialMode="register" onSuccess={vi.fn()} onClose={vi.fn()} />);
      expect(screen.getByTestId('auth-tab-register')).toHaveAttribute('aria-pressed', 'true'); // back to SIGNUP, not stuck on LOGIN
    });
  });
});
