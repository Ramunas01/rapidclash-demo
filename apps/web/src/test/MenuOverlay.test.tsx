// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HubToolbar } from '../components/hub-chrome/HubToolbar.js';
import { MenuOverlay } from '../components/hub-chrome/MenuOverlay.js';
import { useMenuOverlay } from '../components/hub-chrome/useMenuOverlay.js';
import { HUB_BODY, HUB_FIXED_TOP } from '../components/hub-chrome/layout.js';
import type { CategoryId } from '../components/hub-shared/categories.js';
import { setThemeChoice } from '../lib/theme.js';

/** A minimal stand-in for how every real hub screen wires `useMenuOverlay` + `HubToolbar` +
 *  `MenuOverlay` together (see HomeHub.tsx/GameHub.tsx/RewardsHub.tsx/ProfileHub.tsx) — issue
 *  #414's own three-piece pattern, without any of a real screen's API/balance/match-history
 *  plumbing that isn't relevant to the overlay's own behavior. */
function Harness({
  onGames = vi.fn(), onRewards = vi.fn(), onAffiliate = vi.fn(), onGamesCategory,
}: {
  onGames?(): void; onRewards?(): void; onAffiliate?(): void;
  onGamesCategory?(category: CategoryId): void;
}) {
  const menu = useMenuOverlay();
  return (
    <>
      <HubToolbar
        onGames={menu.wrap(onGames)}
        onAccount={menu.wrap(vi.fn())}
        onRewards={menu.wrap(onRewards)}
        onMenu={menu.onMenu}
        reportAnchorRect={menu.reportAnchorRect}
        onChat={vi.fn()}
        active={menu.open ? 'menu' : 'games'}
      />
      <MenuOverlay
        open={menu.open}
        anchorRect={menu.anchorRect}
        onClose={menu.close}
        onOpenGames={onGames}
        onOpenRewards={onRewards}
        onOpenAffiliate={onAffiliate}
        onOpenGamesCategory={onGamesCategory}
      />
    </>
  );
}

function isOpen(overlay: HTMLElement) {
  return overlay.getAttribute('aria-hidden') === 'false' && (overlay.style.pointerEvents === 'auto');
}

// lib/theme.ts is a module-level singleton shared across every test in this file (same reasoning
// as PreferencesHub.test.tsx's own beforeEach) — reset it to a known baseline explicitly before
// each test, since the APPEARANCE control's own tests below flip it.
beforeEach(() => {
  localStorage.clear();
  setThemeChoice('dark');
});

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

describe('Menu overlay (issue #446) — backdrop z-index, bottom clearance, top clearance', () => {
  it("z-[18] wrapper sits strictly between the backdrop's z-20 and the pill/header's z-20 no longer applies — the backdrop layers are bumped to z-20 too, matching the pill", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('hub-nav-menu'));
    expect(screen.getByTestId('hub-nav-fade').className).toContain('z-20');
    expect(screen.getByTestId('hub-nav-fill').className).toContain('z-20');
    expect(screen.getByTestId('hub-nav-fade').className).not.toContain('z-[15]');
    expect(screen.getByTestId('hub-nav-fill').className).not.toContain('z-[15]');
    // The overlay's own wrapper stays z-[18] — unchanged by this fix — but no longer sits above
    // the backdrop layers now that they're both z-20 (same tier as the nav pill above it).
    expect(screen.getByTestId('menu-overlay').className).toContain('z-[18]');
  });

  it('the bottom clearance under the MENU content uses the shared HUB_BODY token, not a flat pb-6', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('hub-nav-menu'));
    const wrapper = screen.getByText('MENU').parentElement;
    expect(wrapper?.className).toContain(HUB_BODY);
    expect(wrapper?.className).not.toContain('pb-6');
  });

  it('the top clearance above MENU uses the shared HUB_FIXED_TOP calc() token, not a flat pt-[130px]', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('hub-nav-menu'));
    const wrapper = screen.getByText('MENU').parentElement;
    expect(wrapper?.className).toContain(HUB_FIXED_TOP);
    expect(wrapper?.className).not.toContain('pt-[130px]');
    expect(wrapper?.className).toContain('env(safe-area-inset-top)');
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

  // Issue #423: the EARN group's Affiliate program row now routes to the real Affiliate screen
  // via onOpenAffiliate — no longer the shared placeholder toast.
  it('the Affiliate program row calls the real onOpenAffiliate and closes the overlay', () => {
    const onAffiliate = vi.fn();
    render(<Harness onAffiliate={onAffiliate} />);
    fireEvent.click(screen.getByTestId('hub-nav-menu'));
    fireEvent.click(screen.getByTestId('menu-row-affiliate'));
    expect(onAffiliate).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('menu-placeholder-toast')).toBeNull();
    expect(screen.getByTestId('menu-overlay').getAttribute('aria-hidden')).toBe('true');
  });

  it('an unwired footer link (Complaint form, which has no COMPETE/PLATFORM row of the same name) also shows the placeholder toast', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('hub-nav-menu'));
    fireEvent.click(screen.getByTestId('home-footer-link-complaint-form'));
    expect(screen.getByTestId('menu-placeholder-toast')).toHaveTextContent('Complaint form — coming soon');
  });

  it('every COMPETE/PLATFORM/SUPPORT row is present and shows its own placeholder toast', () => {
    render(<Harness />);
    const rows = [
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

// Issue #465: the GAMES group's "RapidClash Originals"/"Card games"/"Chance games"/"Skill games"
// rows used to be permanent placeholder toasts (built speculatively ahead of the games-hero
// rebuild) — they now open the Games view pre-filtered to the tapped category.
describe('Menu overlay (issue #465) — GAMES group category rows', () => {
  const ROW_CATEGORY: [string, CategoryId][] = [
    ['originals', 'originals'],
    ['card-games', 'card'],
    ['chance-games', 'chance'],
    ['skill-games', 'skill'],
  ];

  it.each(ROW_CATEGORY)('the "%s" row calls onOpenGamesCategory with %s and closes the overlay, no toast', (key, category) => {
    const onGamesCategory = vi.fn();
    render(<Harness onGamesCategory={onGamesCategory} />);
    fireEvent.click(screen.getByTestId('hub-nav-menu'));
    fireEvent.click(screen.getByTestId(`menu-row-${key}`));
    expect(onGamesCategory).toHaveBeenCalledWith(category);
    expect(onGamesCategory).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('menu-placeholder-toast')).toBeNull();
    expect(screen.getByTestId('menu-overlay').getAttribute('aria-hidden')).toBe('true');
  });

  it('without onOpenGamesCategory wired, a GAMES-group row falls back to plain onOpenGames (real nav, not a toast)', () => {
    const onGames = vi.fn();
    render(<Harness onGames={onGames} />); // no onGamesCategory passed
    fireEvent.click(screen.getByTestId('hub-nav-menu'));
    fireEvent.click(screen.getByTestId('menu-row-card-games'));
    expect(onGames).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('menu-placeholder-toast')).toBeNull();
    expect(screen.getByTestId('menu-overlay').getAttribute('aria-hidden')).toBe('true');
  });
});

// Ticket 2026-09-13#2, item 1: the APPEARANCE Dark/Light pill control, previously missing
// entirely (GROUPS ended at SUPPORT with nothing after it). Reuses the real lib/theme.ts module
// (via setThemeChoice), same approach PreferencesHub.test.tsx already takes for its own
// theme-dependent rendering — no mock, since the module IS the thing under test here.
describe('Menu overlay (ticket 2026-09-13#2, item 1) — APPEARANCE Dark/Light control', () => {
  it('renders the APPEARANCE label and both Dark/Light buttons', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('hub-nav-menu'));
    expect(screen.getByText('APPEARANCE')).toBeInTheDocument();
    expect(screen.getByTestId('menu-appearance-dark')).toHaveTextContent('Dark');
    expect(screen.getByTestId('menu-appearance-light')).toHaveTextContent('Light');
  });

  it('clicking Dark calls setChoice(\'dark\') — the same persisted global PreferencesHub.tsx reads', () => {
    setThemeChoice('light');
    render(<Harness />);
    fireEvent.click(screen.getByTestId('hub-nav-menu'));
    fireEvent.click(screen.getByTestId('menu-appearance-dark'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('rc_pref_theme')).toBe('dark');
  });

  it('clicking Light calls setChoice(\'light\')', () => {
    render(<Harness />); // baseline theme is 'dark' (top-level beforeEach)
    fireEvent.click(screen.getByTestId('hub-nav-menu'));
    fireEvent.click(screen.getByTestId('menu-appearance-light'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('rc_pref_theme')).toBe('light');
  });

  it('the currently-resolved theme\'s button gets the purple/brand background + active shadow; the other gets the neutral/inactive treatment', () => {
    setThemeChoice('dark');
    render(<Harness />);
    fireEvent.click(screen.getByTestId('hub-nav-menu'));
    const darkBtn = screen.getByTestId('menu-appearance-dark');
    const lightBtn = screen.getByTestId('menu-appearance-light');
    expect(darkBtn.style.background).toBe('var(--brand-purple)');
    expect(darkBtn.style.boxShadow).toBe('var(--rc-theme-toggle-active-shadow)');
    expect(lightBtn.style.background).toBe('var(--rc-theme-toggle-inactive-bg)');
    expect(lightBtn.style.boxShadow).toBe('var(--rc-theme-toggle-inactive-shadow)');
  });

  it('flips which button reads active when the resolved theme flips to light', () => {
    setThemeChoice('light');
    render(<Harness />);
    fireEvent.click(screen.getByTestId('hub-nav-menu'));
    const darkBtn = screen.getByTestId('menu-appearance-dark');
    const lightBtn = screen.getByTestId('menu-appearance-light');
    expect(lightBtn.style.background).toBe('var(--brand-purple)');
    expect(lightBtn.style.boxShadow).toBe('var(--rc-theme-toggle-active-shadow)');
    expect(darkBtn.style.background).toBe('var(--rc-theme-toggle-inactive-bg)');
    expect(darkBtn.style.boxShadow).toBe('var(--rc-theme-toggle-inactive-shadow)');
  });
});
