// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CoinflipHubScreen } from '../screens/CoinflipHub.js';

describe('CoinflipHubScreen (Part 1 — chrome + shell)', () => {
  beforeEach(() => {
    // The wallet chip pulls a live balance via api.wallet → GET /wallet.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ balance: 1250, entries: [] }),
    } as Response));
  });
  afterEach(() => vi.unstubAllGlobals());

  function renderHub(over: Partial<Parameters<typeof CoinflipHubScreen>[0]> = {}) {
    const props = {
      token: 'tok',
      initialBalance: 1000,
      onOpenWallet: vi.fn(),
      onOpenGameList: vi.fn(),
      ...over,
    };
    const result = render(<CoinflipHubScreen {...props} />);
    return { ...props, ...result };
  }

  it('shows the live balance in ¢ (formatCredits), not $', async () => {
    renderHub();
    // initial balance shows immediately, then the live value resolves.
    expect(screen.getByTestId('hub-balance').textContent).toBe('1,000¢');
    await waitFor(() => expect(screen.getByTestId('hub-balance').textContent).toBe('1,250¢'));
  });

  it('wallet chip opens the wallet/account screen', () => {
    const { onOpenWallet } = renderHub();
    fireEvent.click(screen.getByTestId('hub-wallet-chip'));
    expect(onOpenWallet).toHaveBeenCalled();
  });

  it('toolbar wires menu/games → game list and account → wallet', () => {
    const { onOpenGameList, onOpenWallet } = renderHub();
    fireEvent.click(screen.getByTestId('hub-nav-menu'));
    fireEvent.click(screen.getByTestId('hub-nav-games'));
    expect(onOpenGameList).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByTestId('hub-nav-account'));
    expect(onOpenWallet).toHaveBeenCalledTimes(1);
  });

  it('rewards/chat are visibly-inactive "coming soon", not silent no-ops', () => {
    renderHub();
    const rewards = screen.getByTestId('hub-nav-rewards');
    const chat = screen.getByTestId('hub-nav-chat');
    expect(rewards.getAttribute('aria-disabled')).toBe('true');
    expect(chat.getAttribute('aria-disabled')).toBe('true');
    // They are not buttons (can't be activated).
    expect(rewards.tagName).not.toBe('BUTTON');
    expect(chat.tagName).not.toBe('BUTTON');
  });

  it('renders all eight body sections in spec order', () => {
    renderHub();
    for (const id of [
      'hub-section-game',
      'hub-section-bet',
      'hub-play',
      'hub-section-challenges',
      'hub-section-related',
      'hub-section-rival',
      'hub-section-clashes',
      'hub-section-footer',
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    // PLAY is inactive until a bet is chosen (Part 2 wires it).
    expect(screen.getByTestId('hub-play')).toBeDisabled();
  });

  it('is sanitized: no $, no gambling-trope / social copy, no house-edge games', async () => {
    const { container } = renderHub();
    await waitFor(() => expect(screen.getByTestId('hub-balance').textContent).toBe('1,250¢'));
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\$/);
    expect(text).not.toMatch(/provably fair|discord|telegram|\d+x|blackjack|limbo|crash|keno|hilo/i);
    // Bet presets render in ¢.
    expect(text).toContain('100¢');
  });
});
