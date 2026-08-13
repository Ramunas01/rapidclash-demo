// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HubToolbar } from '../components/hub-chrome/HubToolbar.js';

describe('HubToolbar — solid #0B0B0B base fill behind the bottom nav', () => {
  it('renders a full-viewport-width fill behind the nav, using the bg token (no hardcoded hex), below the pill', () => {
    render(<HubToolbar onGames={vi.fn()} onAccount={vi.fn()} onRewards={vi.fn()} />);
    const fill = screen.getByTestId('hub-nav-fill');
    const cls = fill.className;

    expect(cls).toContain('fixed');
    // Full width — NOT max-w-md — so nothing peeks past its sides on wider screens.
    expect(cls).toMatch(/\bleft-0\b/);
    expect(cls).toMatch(/\bright-0\b/);
    expect(cls).not.toMatch(/max-w-md/);
    // The canonical token, never a fresh literal (would re-create the unification drift).
    expect(cls).toContain('bg-background');
    expect(cls).not.toContain('#'); // no inline hex
    // Purely visual, below the nav (z-[15] < the nav's z-20) so the pill floats over it.
    expect(cls).toContain('pointer-events-none');
    expect(cls).toContain('z-[15]');
    const nav = fill.parentElement?.querySelector('nav');
    expect(nav?.className).toContain('z-20'); // pill/nav above the fill
  });

  it('covers the home-indicator safe-area inset (reaches bottom:0 including the safe zone)', () => {
    render(<HubToolbar onGames={vi.fn()} onAccount={vi.fn()} onRewards={vi.fn()} />);
    const cls = screen.getByTestId('hub-nav-fill').className;
    expect(cls).toContain('bottom-0');
    expect(cls).toContain('env(safe-area-inset-bottom)'); // its height includes the safe area
  });

  it('nav buttons still tap through — the fill is pointer-events-none and beneath the pill', () => {
    const onGames = vi.fn();
    const onAccount = vi.fn();
    const onRewards = vi.fn();
    render(<HubToolbar onGames={onGames} onAccount={onAccount} onRewards={onRewards} />);
    expect(screen.getByTestId('hub-nav-fill').className).toContain('pointer-events-none');
    fireEvent.click(screen.getByTestId('hub-nav-games'));
    expect(onGames).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('hub-nav-account'));
    expect(onAccount).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('hub-nav-rewards'));
    expect(onRewards).toHaveBeenCalled();
  });

  it('Menu & Chat are reserved — greyed / aria-disabled / not an actionable button', () => {
    render(<HubToolbar onGames={vi.fn()} onAccount={vi.fn()} onRewards={vi.fn()} />);
    for (const label of ['menu', 'chat']) {
      const item = screen.getByTestId(`hub-nav-${label}`);
      // Reserved items render as a non-button div, visibly inactive & aria-disabled.
      expect(item.tagName).toBe('DIV');
      expect(item.getAttribute('aria-disabled')).toBe('true');
      expect(item.className).toContain('opacity-40');
    }
  });

  it('Games, Account & Rewards are all live buttons that fire their handlers (issue #307: Rewards flipped from coming-soon)', () => {
    const onGames = vi.fn();
    const onAccount = vi.fn();
    const onRewards = vi.fn();
    render(<HubToolbar onGames={onGames} onAccount={onAccount} onRewards={onRewards} />);
    for (const label of ['games', 'account', 'rewards']) {
      const item = screen.getByTestId(`hub-nav-${label}`);
      expect(item.tagName).toBe('BUTTON');
      expect(item.getAttribute('aria-disabled')).toBeNull();
    }
    fireEvent.click(screen.getByTestId('hub-nav-games'));
    expect(onGames).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('hub-nav-account'));
    expect(onAccount).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('hub-nav-rewards'));
    expect(onRewards).toHaveBeenCalled();
  });

  it('active="rewards" highlights the Rewards item (aria-current + brand colour), matching Games/Account', () => {
    render(<HubToolbar onGames={vi.fn()} onAccount={vi.fn()} onRewards={vi.fn()} active="rewards" />);
    const rewards = screen.getByTestId('hub-nav-rewards');
    expect(rewards.getAttribute('aria-current')).toBe('page');
    expect(rewards.className).toContain('text-brand');
    expect(screen.getByTestId('hub-nav-games').getAttribute('aria-current')).toBeNull();
    expect(screen.getByTestId('hub-nav-account').getAttribute('aria-current')).toBeNull();
  });
});
