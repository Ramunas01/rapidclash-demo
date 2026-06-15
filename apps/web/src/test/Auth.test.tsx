// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthScreen } from '../screens/Auth.js';

describe('AuthScreen', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('shows register and login tabs', () => {
    const onLogin = vi.fn();
    render(<AuthScreen onLogin={onLogin} />);
    expect(screen.getByText('Register')).toBeTruthy();
    expect(screen.getByText('Login')).toBeTruthy();
  });

  it('submits register and calls onLogin with token and playerId', async () => {
    const onLogin = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'tok123', playerId: 'pid1', balance: 1000, username: 'alice' }),
    } as Response);

    render(<AuthScreen onLogin={onLogin} />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByText('Create Account'));

    await waitFor(() => {
      // #34: the alias is forwarded so the app can show "who you are".
      expect(onLogin).toHaveBeenCalledWith('tok123', 'pid1', 1000, 'alice');
    });
  });

  it('shows error message on failed register', async () => {
    const onLogin = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Username already taken' }),
    } as Response);

    render(<AuthScreen onLogin={onLogin} />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByText('Create Account'));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('already taken');
    });
    expect(onLogin).not.toHaveBeenCalled();
  });

  it('toggles to the login tab and submits via api.login', async () => {
    const onLogin = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'tok9', playerId: 'pid9', balance: 500, username: 'bob' }),
    } as Response);

    render(<AuthScreen onLogin={onLogin} />);
    // Default tab is register → submit reads "Create Account"; switching shows "Sign In".
    fireEvent.click(screen.getByText('Login'));
    expect(screen.getByText('Sign In')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'bob' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByText('Sign In'));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith('tok9', 'pid9', 500, 'bob');
    });
    // The login endpoint was hit (data layer unchanged).
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('/auth/login');
  });

  // Re-skin guardrail: the investor demo must read as play-money, never crypto/real-money.
  it('frames the hero as play-money with no crypto / deposit affordance', () => {
    const onLogin = vi.fn();
    const { container } = render(<AuthScreen onLogin={onLogin} />);
    const text = container.textContent ?? '';
    expect(text).toMatch(/play-money/i);
    expect(text).not.toMatch(/crypto|deposit|buy chips|USDT|\bETH\b|\bBTC\b|\$/i);
  });
});
