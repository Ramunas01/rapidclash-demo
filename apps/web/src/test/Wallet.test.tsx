// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { WalletScreen } from '../screens/Wallet.js';

describe('WalletScreen', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders balance from GET /wallet', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        balance: 950,
        entries: [
          { id: '1', type: 'GRANT', amount: 1000, idempotencyKey: 'g1', createdAt: '2024-01-01' },
          { id: '2', type: 'BET_ESCROW', amount: -50, idempotencyKey: 'e1', createdAt: '2024-01-02' },
        ],
      }),
    } as Response);

    render(<WalletScreen token="tok" username="alice" balance={0} onPlay={() => {}} onLogout={() => {}} />);

    await waitFor(() => {
      expect(screen.getByLabelText('balance').textContent).toContain('950');
    });
    // GRANT type displayed as "GRANT"
    expect(screen.getAllByText('GRANT').length).toBeGreaterThan(0);
  });

  it('shows the signed-in player their own alias (#34)', () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ balance: 1000, entries: [] }),
    } as Response);

    render(<WalletScreen token="tok" username="alice" balance={1000} onPlay={() => {}} onLogout={() => {}} />);

    expect(screen.getByTestId('signed-in-as').textContent).toBe('Signed in as alice');
  });
});
