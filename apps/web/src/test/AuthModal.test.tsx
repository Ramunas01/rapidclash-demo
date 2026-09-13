// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthModal } from '../components/AuthModal.js';

describe('AuthModal', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (u.includes('/auth/register'))
        return { ok: true, json: async () => ({ token: 'T', playerId: 'P', balance: 1000, username: body.username, avatarId: 'default' }) } as Response;
      if (u.includes('/auth/login'))
        return { ok: true, json: async () => ({ token: 'T2', playerId: 'P2', balance: 42, username: body.username, avatarId: 'rc-04' }) } as Response;
      return { ok: false, json: async () => ({ error: 'nope' }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('register → onSuccess with the new token + the 1000-credit grant', async () => {
    const onSuccess = vi.fn();
    render(<AuthModal open onSuccess={onSuccess} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'neo' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('auth-submit'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('T', 'P', 1000, 'neo', 'default'));
  });

  it('login tab → onSuccess with the existing account', async () => {
    const onSuccess = vi.fn();
    render(<AuthModal open onSuccess={onSuccess} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('auth-tab-login'));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'trinity' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('auth-submit'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('T2', 'P2', 42, 'trinity', 'rc-04'));
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
    expect(screen.getByTestId('auth-title').textContent).toBe('Sign up');
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
    expect(screen.getByTestId('auth-title').textContent).toBe('Login');
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
});
