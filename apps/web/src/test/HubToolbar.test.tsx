// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HubToolbar } from '../components/hub-chrome/HubToolbar.js';

describe('HubToolbar — solid #0B0B0B base fill behind the bottom nav', () => {
  it('renders a full-viewport-width fill behind the nav, using the bg token (no hardcoded hex), below the pill', () => {
    render(<HubToolbar onGames={vi.fn()} onAccount={vi.fn()} onRewards={vi.fn()} onMenu={vi.fn()} />);
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
    // Purely visual, z-20 — same tier as the nav pill (issue #446: was z-[15], which the Menu
    // overlay's own z-[18] wrapper painted over, hiding this layer whenever it was open). Document
    // order still puts the pill on top since it renders after this layer.
    expect(cls).toContain('pointer-events-none');
    expect(cls).toContain('z-20');
    expect(cls).not.toContain('z-[15]');
    const nav = fill.parentElement?.querySelector('nav');
    expect(nav?.className).toContain('z-20'); // pill/nav above the fill
  });

  it('covers the home-indicator safe-area inset (reaches bottom:0 including the safe zone)', () => {
    render(<HubToolbar onGames={vi.fn()} onAccount={vi.fn()} onRewards={vi.fn()} onMenu={vi.fn()} />);
    const cls = screen.getByTestId('hub-nav-fill').className;
    expect(cls).toContain('bottom-0');
    expect(cls).toContain('env(safe-area-inset-bottom)'); // its height includes the safe area
  });

  it('nav buttons still tap through — the fill is pointer-events-none and beneath the pill', () => {
    const onGames = vi.fn();
    const onAccount = vi.fn();
    const onRewards = vi.fn();
    render(<HubToolbar onGames={onGames} onAccount={onAccount} onRewards={onRewards} onMenu={vi.fn()} />);
    expect(screen.getByTestId('hub-nav-fill').className).toContain('pointer-events-none');
    fireEvent.click(screen.getByTestId('hub-nav-games'));
    expect(onGames).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('hub-nav-account'));
    expect(onAccount).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('hub-nav-rewards'));
    expect(onRewards).toHaveBeenCalled();
  });

  it('Chat is reserved — greyed / aria-disabled / not an actionable button', () => {
    render(<HubToolbar onGames={vi.fn()} onAccount={vi.fn()} onRewards={vi.fn()} onMenu={vi.fn()} />);
    const item = screen.getByTestId('hub-nav-chat');
    // Reserved items render as a non-button div, visibly inactive & aria-disabled.
    expect(item.tagName).toBe('DIV');
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.className).toContain('opacity-40');
  });

  it('Games, Account, Rewards & Menu are all live buttons that fire their handlers (issue #414: Menu flipped from coming-soon)', () => {
    const onGames = vi.fn();
    const onAccount = vi.fn();
    const onRewards = vi.fn();
    const onMenu = vi.fn();
    render(<HubToolbar onGames={onGames} onAccount={onAccount} onRewards={onRewards} onMenu={onMenu} />);
    for (const label of ['games', 'account', 'rewards', 'menu']) {
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
    fireEvent.click(screen.getByTestId('hub-nav-menu'));
    expect(onMenu).toHaveBeenCalledTimes(1);
    // Called with the tapped button's own live rect (jsdom returns all-zero rects, but the
    // shape must be the plain {left,top,width,height} MenuAnchorRect — never a raw DOMRect).
    expect(onMenu.mock.calls[0][0]).toEqual(
      expect.objectContaining({ left: expect.any(Number), top: expect.any(Number), width: expect.any(Number), height: expect.any(Number) }),
    );
  });

  it('active="menu" highlights the Menu item (aria-current + brand colour), matching Games/Account/Rewards', () => {
    render(<HubToolbar onGames={vi.fn()} onAccount={vi.fn()} onRewards={vi.fn()} onMenu={vi.fn()} active="menu" />);
    const menu = screen.getByTestId('hub-nav-menu');
    expect(menu.getAttribute('aria-current')).toBe('page');
    expect(menu.className).toContain('text-brand');
    expect(screen.getByTestId('hub-nav-games').getAttribute('aria-current')).toBeNull();
  });

  it('active="rewards" highlights the Rewards item (aria-current + brand colour), matching Games/Account', () => {
    render(<HubToolbar onGames={vi.fn()} onAccount={vi.fn()} onRewards={vi.fn()} onMenu={vi.fn()} active="rewards" />);
    const rewards = screen.getByTestId('hub-nav-rewards');
    expect(rewards.getAttribute('aria-current')).toBe('page');
    expect(rewards.className).toContain('text-brand');
    expect(screen.getByTestId('hub-nav-games').getAttribute('aria-current')).toBeNull();
    expect(screen.getByTestId('hub-nav-account').getAttribute('aria-current')).toBeNull();
  });
});

describe('HubToolbar — scroll-fade layer + label size (issue #407, navbar polish Part B)', () => {
  it('renders a gradient scroll-fade above the solid fill, using the bg token (no hardcoded hex)', () => {
    render(<HubToolbar onGames={vi.fn()} onAccount={vi.fn()} onRewards={vi.fn()} onMenu={vi.fn()} />);
    const fade = screen.getByTestId('hub-nav-fade');
    const cls = fade.className;

    expect(cls).toContain('fixed');
    expect(cls).toMatch(/\bleft-0\b/);
    expect(cls).toMatch(/\bright-0\b/);
    expect(cls).not.toMatch(/max-w-md/);
    // Gradient dissolve built from the canonical bg token, not a parallel --rc-bg literal.
    expect(cls).toContain('linear-gradient(to_top');
    expect(cls).toContain('hsl(var(--background))');
    expect(cls).not.toMatch(/#[0-9a-fA-F]{3,6}/); // no inline hex
    expect(cls).toContain('h-[62px]');
    // Purely visual, z-20 (issue #446 — same tier as the nav pill), pointer-events pass through.
    expect(cls).toContain('pointer-events-none');
    expect(cls).toContain('z-20');
    expect(cls).not.toContain('z-[15]');
    const nav = fade.parentElement?.querySelector('nav');
    expect(nav?.className).toContain('z-20'); // pill/nav still above the fade

    // Sits directly above the existing solid fill (same bottom offset as the fill's height),
    // not replacing it — both layers must be present.
    const fill = screen.getByTestId('hub-nav-fill');
    expect(cls).toContain('bottom-[calc(2.75rem_+_env(safe-area-inset-bottom))]');
    expect(fill.className).toContain('h-[calc(2.75rem_+_env(safe-area-inset-bottom))]');
  });

  it('the fade does not block taps on the pill buttons', () => {
    const onGames = vi.fn();
    render(<HubToolbar onGames={onGames} onAccount={vi.fn()} onRewards={vi.fn()} onMenu={vi.fn()} />);
    expect(screen.getByTestId('hub-nav-fade').className).toContain('pointer-events-none');
    fireEvent.click(screen.getByTestId('hub-nav-games'));
    expect(onGames).toHaveBeenCalled();
  });

  it('item labels render at 12px (bumped from the old 10.5px)', () => {
    render(<HubToolbar onGames={vi.fn()} onAccount={vi.fn()} onRewards={vi.fn()} onMenu={vi.fn()} />);
    for (const label of ['menu', 'games', 'account', 'rewards', 'chat']) {
      const span = screen.getByTestId(`hub-nav-${label}`).querySelector('span');
      expect(span?.className).toContain('text-[12px]');
      expect(span?.className).not.toContain('10.5px');
    }
  });

  it('regression guard: Chat stays inert/aria-disabled, Menu is live but inactive, and Games active styling is unchanged', () => {
    render(<HubToolbar onGames={vi.fn()} onAccount={vi.fn()} onRewards={vi.fn()} onMenu={vi.fn()} active="games" />);
    const chat = screen.getByTestId('hub-nav-chat');
    expect(chat.tagName).toBe('DIV');
    expect(chat.getAttribute('aria-disabled')).toBe('true');
    expect(chat.className).toContain('opacity-40');

    const menu = screen.getByTestId('hub-nav-menu');
    expect(menu.tagName).toBe('BUTTON');
    expect(menu.getAttribute('aria-current')).toBeNull();
    expect(menu.className).not.toContain('text-brand');

    const games = screen.getByTestId('hub-nav-games');
    expect(games.getAttribute('aria-current')).toBe('page');
    expect(games.className).toContain('text-brand');
    expect(games.className).toContain('drop-shadow-[0_0_5px_#8140e288]');
  });
});

describe('HubToolbar — backdrop z-index bump to z-20 (issue #446)', () => {
  // Games/Account/Rewards (and every other hub screen that renders HubToolbar without also
  // mounting MenuOverlay's z-[18] wrapper in the same stacking context) have nothing between the
  // old z-[15] and the pill's z-20 today — so raising the backdrop layers to z-20 must not change
  // anything observable about them: same elements, same order, same tap-through behavior. This
  // reproduces exactly what those screens render (plain HubToolbar, standalone) to prove that.
  it('both backdrop layers are z-20 (matching the pill), with no z-[15] left anywhere', () => {
    render(<HubToolbar onGames={vi.fn()} onAccount={vi.fn()} onRewards={vi.fn()} onMenu={vi.fn()} />);
    expect(screen.getByTestId('hub-nav-fade').className).toContain('z-20');
    expect(screen.getByTestId('hub-nav-fill').className).toContain('z-20');
    expect(screen.getByTestId('hub-nav-fade').className).not.toContain('z-[15]');
    expect(screen.getByTestId('hub-nav-fill').className).not.toContain('z-[15]');
  });

  it('on a screen with no overlay in its stacking context, the pill still renders after (visually above) both backdrop layers in DOM order, and nav buttons still tap through unchanged', () => {
    const onGames = vi.fn();
    const onAccount = vi.fn();
    const onRewards = vi.fn();
    const { container } = render(
      <HubToolbar onGames={onGames} onAccount={onAccount} onRewards={onRewards} onMenu={vi.fn()} />,
    );
    // Same tier (z-20) as the pill on all three siblings — order among equal-z-index siblings
    // falls back to document order, so the pill (rendered last) still paints on top, same as
    // before this fix when it was strictly higher (z-20 > z-[15]).
    const children = Array.from(container.children);
    const fadeIdx = children.indexOf(screen.getByTestId('hub-nav-fade'));
    const fillIdx = children.indexOf(screen.getByTestId('hub-nav-fill'));
    const navIdx = children.findIndex((el) => el.tagName === 'NAV');
    expect(fadeIdx).toBeGreaterThanOrEqual(0);
    expect(fillIdx).toBeGreaterThan(fadeIdx);
    expect(navIdx).toBeGreaterThan(fillIdx);

    // Unaffected rendering: pointer-events-none on both backdrop layers, buttons still fire.
    expect(screen.getByTestId('hub-nav-fade').className).toContain('pointer-events-none');
    expect(screen.getByTestId('hub-nav-fill').className).toContain('pointer-events-none');
    fireEvent.click(screen.getByTestId('hub-nav-games'));
    expect(onGames).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('hub-nav-account'));
    expect(onAccount).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('hub-nav-rewards'));
    expect(onRewards).toHaveBeenCalled();
  });
});

describe('HubToolbar — icon geometry & sizing (issue #328, matching design-ref/navbar/RapidClash Navbar.html)', () => {
  it('all 5 icons render at 24x24 (h-6 w-6, up from the old 23px)', () => {
    render(<HubToolbar onGames={vi.fn()} onAccount={vi.fn()} onRewards={vi.fn()} onMenu={vi.fn()} />);
    for (const label of ['menu', 'games', 'account', 'rewards', 'chat']) {
      const svg = screen.getByTestId(`hub-nav-${label}`).querySelector('svg');
      expect(svg?.getAttribute('class')).toContain('h-6');
      expect(svg?.getAttribute('class')).toContain('w-6');
      // Tint stays class-driven via the wrapping button/div, never hardcoded on the SVG itself.
      expect(svg?.getAttribute('fill')).toBe('currentColor');
    }
  });

  it('the bar pill uses 12px vertical padding (py-3), horizontal (px-1.5) unchanged', () => {
    render(<HubToolbar onGames={vi.fn()} onAccount={vi.fn()} onRewards={vi.fn()} onMenu={vi.fn()} />);
    const pill = screen.getByTestId('hub-nav-games').parentElement;
    expect(pill?.className).toContain('py-3');
    expect(pill?.className).not.toContain('py-2.5');
    expect(pill?.className).toContain('px-1.5');
  });

  it('Menu uses the refined 3-bar geometry (x=3.5, width=17, rx=1.55)', () => {
    render(<HubToolbar onGames={vi.fn()} onAccount={vi.fn()} onRewards={vi.fn()} onMenu={vi.fn()} />);
    const rects = screen.getByTestId('hub-nav-menu').querySelectorAll('rect');
    expect(rects).toHaveLength(3);
    const ys = Array.from(rects).map((r) => r.getAttribute('y'));
    expect(ys).toEqual(['5.6', '10.5', '15.4']);
    for (const r of Array.from(rects)) {
      expect(r.getAttribute('x')).toBe('3.5');
      expect(r.getAttribute('width')).toBe('17');
      expect(r.getAttribute('height')).toBe('3.1');
      expect(r.getAttribute('rx')).toBe('1.55');
    }
  });

  it('Games is the bolt mark with its own non-standard viewBox, not the old spade in 0 0 24 24', () => {
    render(<HubToolbar onGames={vi.fn()} onAccount={vi.fn()} onRewards={vi.fn()} onMenu={vi.fn()} />);
    const svg = screen.getByTestId('hub-nav-games').querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 351 374');
    const path = svg?.querySelector('path');
    expect(path?.getAttribute('d')).toMatch(/^M189\.84 23\.99/);
  });

  it('Account uses the refined silhouette (cy=7.5, tightened shoulders path)', () => {
    render(<HubToolbar onGames={vi.fn()} onAccount={vi.fn()} onRewards={vi.fn()} onMenu={vi.fn()} />);
    const svg = screen.getByTestId('hub-nav-account').querySelector('svg');
    expect(svg?.querySelector('circle')?.getAttribute('cy')).toBe('7.5');
    expect(svg?.querySelector('path')?.getAttribute('d')).toBe('M4.5 21c0-4.1 3.4-7 7.5-7s7.5 2.9 7.5 7z');
  });

  it('Rewards is a two-part bow+box composition — a rotated <g> bow plus a separate unrotated box path', () => {
    render(<HubToolbar onGames={vi.fn()} onAccount={vi.fn()} onRewards={vi.fn()} onMenu={vi.fn()} />);
    const svg = screen.getByTestId('hub-nav-rewards').querySelector('svg');
    const g = svg?.querySelector('g');
    expect(g?.getAttribute('transform')).toBe('rotate(-9 12 8)');
    expect(g?.querySelector('path')).not.toBeNull();
    // The box-body path is a sibling of <g>, not nested inside it (two-part, not flattened).
    const directPaths = Array.from(svg?.children ?? []).filter((el) => el.tagName === 'path');
    expect(directPaths).toHaveLength(1);
  });

  it('Chat uses the refined speech-bubble bounds (corner radius 2.4)', () => {
    render(<HubToolbar onGames={vi.fn()} onAccount={vi.fn()} onRewards={vi.fn()} onMenu={vi.fn()} />);
    const svg = screen.getByTestId('hub-nav-chat').querySelector('svg');
    expect(svg?.querySelector('path')?.getAttribute('d')).toBe(
      'M5.4 4h13.2A2.4 2.4 0 0 1 21 6.4v7.8a2.4 2.4 0 0 1-2.4 2.4H9.8L5.2 20.4A.7.7 0 0 1 4 19.8V6.4A2.4 2.4 0 0 1 5.4 4z',
    );
  });
});
