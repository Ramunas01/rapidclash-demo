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
      json: async () => ({ token: 'tok123', playerId: 'pid1', balance: 1000 }),
    } as Response);

    render(<AuthScreen onLogin={onLogin} />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByText('Create Account'));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith('tok123', 'pid1', 1000);
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
});
