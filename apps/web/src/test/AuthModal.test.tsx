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
        return { ok: true, json: async () => ({ token: 'T2', playerId: 'P2', balance: 42, username: body.username, avatarId: 'boy-dark' }) } as Response;
      return { ok: false, json: async () => ({ error: 'nope' }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('register → onSuccess with the new token + the 1000-credit grant', async () => {
    const onSuccess = vi.fn();
    render(<AuthModal onSuccess={onSuccess} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'neo' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('auth-submit'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('T', 'P', 1000, 'neo', 'default'));
  });

  it('login tab → onSuccess with the existing account', async () => {
    const onSuccess = vi.fn();
    render(<AuthModal onSuccess={onSuccess} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('auth-tab-login'));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'trinity' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('auth-submit'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('T2', 'P2', 42, 'trinity', 'boy-dark'));
  });

  it('surfaces a server error and does not resolve', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Username taken' }) } as Response)));
    const onSuccess = vi.fn();
    render(<AuthModal onSuccess={onSuccess} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'dup' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('auth-submit'));
    await waitFor(() => expect(screen.getByTestId('auth-error').textContent).toContain('Username taken'));
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('dismiss invokes onClose', () => {
    const onClose = vi.fn();
    render(<AuthModal onSuccess={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(onClose).toHaveBeenCalled();
  });

  it('restyle: fixed header copy, "Sign up" tab label, new disclaimer copy', () => {
    render(<AuthModal onSuccess={vi.fn()} onClose={vi.fn()} />);
    // Header is hardcoded (no per-wall title prop) — same wording for every wall.
    expect(screen.getByText('Create an account or Login')).toBeInTheDocument();
    // The register tab keeps its state value + testid but reads "Sign up".
    const register = screen.getByTestId('auth-tab-register');
    expect(register.textContent).toBe('Sign up');
    expect(screen.queryByText('Register')).toBeNull();
    // Disclaimer: no middot, credits-only framing.
    expect(
      screen.getByText('Play-money demo credits only, no real-money wagering.'),
    ).toBeInTheDocument();
  });

  it('restyle: bg-surface panel (no border), solid bg-brand submit, bg-background toggle tray', () => {
    const { container } = render(<AuthModal onSuccess={vi.fn()} onClose={vi.fn()} />);
    const panel = container.querySelector('.max-w-sm')!;
    expect(panel.className).toContain('bg-surface');
    expect(panel.className).not.toContain('border-border');
    const submit = screen.getByTestId('auth-submit');
    expect(submit.className).toContain('bg-brand');
    expect(submit.className).not.toContain('bg-gradient-to-r');
    const tray = screen.getByTestId('auth-tab-register').parentElement!;
    expect(tray.className).toContain('bg-background');
  });
});
