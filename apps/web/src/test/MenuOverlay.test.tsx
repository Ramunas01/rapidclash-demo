// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HubToolbar } from '../components/hub-chrome/HubToolbar.js';
import { MenuOverlay } from '../components/hub-chrome/MenuOverlay.js';
import { useMenuOverlay } from '../components/hub-chrome/useMenuOverlay.js';

/** A minimal stand-in for how every real hub screen wires `useMenuOverlay` + `HubToolbar` +
 *  `MenuOverlay` together (see HomeHub.tsx/GameHub.tsx/RewardsHub.tsx/ProfileHub.tsx) — issue
 *  #414's own three-piece pattern, without any of a real screen's API/balance/match-history
 *  plumbing that isn't relevant to the overlay's own behavior. */
function Harness({ onGames = vi.fn(), onRewards = vi.fn() }: { onGames?(): void; onRewards?(): void }) {
  const menu = useMenuOverlay();
  return (
    <>
      <HubToolbar
        onGames={menu.wrap(onGames)}
        onAccount={menu.wrap(vi.fn())}
        onRewards={menu.wrap(onRewards)}
        onMenu={menu.onMenu}
        active={menu.open ? 'menu' : 'games'}
      />
      <MenuOverlay open={menu.open} anchorRect={menu.anchorRect} onClose={menu.close} onOpenGames={onGames} onOpenRewards={onRewards} />
    </>
  );
}

function isOpen(overlay: HTMLElement) {
  return overlay.getAttribute('aria-hidden') === 'false' && (overlay.style.pointerEvents === 'auto');
}

describe('Menu overlay (issue #414) — open/close', () => {
  it('starts closed: aria-hidden, pointer-events none, Menu item not active', () => {
    render(<Harness />);
    const overlay = screen.getByTestId('menu-overlay');
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(overlay.style.pointerEvents).toBe('none');
    expect(screen.getByTestId('hub-nav-menu').getAttribute('aria-current')).toBeNull();
  });

  it('tapping Menu opens the overlay and gives the Menu nav item the active/brand treatment', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('hub-nav-menu'));
    const overlay = screen.getByTestId('menu-overlay');
    expect(isOpen(overlay)).toBe(true);
    const menuBtn = screen.getByTestId('hub-nav-menu');
    expect(menuBtn.getAttribute('aria-current')).toBe('page');
    expect(menuBtn.className).toContain('text-brand');
  });

  it('tapping Menu again closes it', () => {
    render(<Harness />);
    const menuBtn = screen.getByTestId('hub-nav-menu');
    fireEvent.click(menuBtn);
    expect(isOpen(screen.getByTestId('menu-overlay'))).toBe(true);
    fireEvent.click(menuBtn);
    const overlay = screen.getByTestId('menu-overlay');
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(overlay.style.pointerEvents).toBe('none');
  });

  it('tapping another nav item (Games) while open closes the overlay too', () => {
    const onGames = vi.fn();
    render(<Harness onGames={onGames} />);
    fireEvent.click(screen.getByTestId('hub-nav-menu'));
    expect(isOpen(screen.getByTestId('menu-overlay'))).toBe(true);
    fireEvent.click(screen.getByTestId('hub-nav-games'));
    expect(onGames).toHaveBeenCalled();
    const overlay = screen.getByTestId('menu-overlay');
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(overlay.style.pointerEvents).toBe('none');
  });
});

describe('Menu overlay (issue #414) — row navigation', () => {
  it('Rewards/VIP row calls the real onOpenRewards and closes the overlay', () => {
    const onRewards = vi.fn();
    render(<Harness onRewards={onRewards} />);
    fireEvent.click(screen.getByTestId('hub-nav-menu'));
    fireEvent.click(screen.getByTestId('menu-row-rewards-vip'));
    expect(onRewards).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('menu-overlay').getAttribute('aria-hidden')).toBe('true');
  });

  it('the footer Games link calls the real onOpenGames and closes the overlay', () => {
    const onGames = vi.fn();
    render(<Harness onGames={onGames} />);
    fireEvent.click(screen.getByTestId('hub-nav-menu'));
    fireEvent.click(screen.getByTestId('home-footer-link-games'));
    expect(onGames).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('menu-overlay').getAttribute('aria-hidden')).toBe('true');
  });

  it('an unwired row (Affiliate program) shows the placeholder toast, calls no navigation, and closes the overlay', () => {
    const onGames = vi.fn();
    const onRewards = vi.fn();
    render(<Harness onGames={onGames} onRewards={onRewards} />);
    fireEvent.click(screen.getByTestId('hub-nav-menu'));
    fireEvent.click(screen.getByTestId('menu-row-affiliate'));
    expect(onGames).not.toHaveBeenCalled();
    expect(onRewards).not.toHaveBeenCalled();
    const toast = screen.getByTestId('menu-placeholder-toast');
    expect(toast).toHaveTextContent('Affiliate program — coming soon');
    expect(screen.getByTestId('menu-overlay').getAttribute('aria-hidden')).toBe('true');
  });

  it('an unwired footer link (Complaint form, which has no COMPETE/PLATFORM row of the same name) also shows the placeholder toast', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('hub-nav-menu'));
    fireEvent.click(screen.getByTestId('home-footer-link-complaint-form'));
    expect(screen.getByTestId('menu-placeholder-toast')).toHaveTextContent('Complaint form — coming soon');
  });

  it('every GAMES/COMPETE/PLATFORM/SUPPORT row is present and shows its own placeholder toast', () => {
    render(<Harness />);
    const rows = [
      'originals', 'card-games', 'chance-games', 'skill-games',
      '24h-race', 'weekly-race', 'leaderboards', 'tournaments',
      'how-it-works', 'provably-fair', 'fees-rake', 'game-rules',
      'help-center', 'contact-us', 'responsible-gaming',
    ];
    for (const key of rows) {
      fireEvent.click(screen.getByTestId('hub-nav-menu')); // re-open (previous row tap closed it)
      const row = screen.getByTestId(`menu-row-${key}`);
      const label = row.textContent ?? '';
      fireEvent.click(row);
      const toastText = screen.getByTestId('menu-placeholder-toast').textContent ?? '';
      expect(toastText).toContain('coming soon');
      expect(toastText).toContain(label);
    }
  });
});
