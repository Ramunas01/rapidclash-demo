// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * A minimal fake MediaQueryList that can actually fire `change` — jsdom has no real
 * matchMedia/prefers-color-scheme support, and every other matchMedia stub in this codebase
 * (App.test.tsx, CoinflipHub.test.tsx, …) is a static one-shot `{ matches: true, ... }` object
 * that never fires an event, which is exactly the "read once at load" behavior issue #472
 * requires `system` NOT to have. This fake supports set(...) to flip `matches` and dispatch
 * `change` to every registered listener, so the live-update path can be exercised for real.
 */
class FakeMediaQueryList {
  matches: boolean;
  media: string;
  private listeners = new Set<() => void>();

  constructor(query: string, matches: boolean) {
    this.media = query;
    this.matches = matches;
  }
  addEventListener(_type: 'change', cb: () => void): void {
    this.listeners.add(cb);
  }
  removeEventListener(_type: 'change', cb: () => void): void {
    this.listeners.delete(cb);
  }
  addListener(cb: () => void): void {
    this.listeners.add(cb);
  }
  removeListener(cb: () => void): void {
    this.listeners.delete(cb);
  }
  dispatchEvent(): boolean {
    return false;
  }
  /** Test helper — flips `matches` and notifies every registered listener, mirroring a real OS
   *  `prefers-color-scheme` flip while the page stays open. */
  set(matches: boolean): void {
    this.matches = matches;
    for (const cb of this.listeners) cb();
  }
  get listenerCount(): number {
    return this.listeners.size;
  }
}

let mql: FakeMediaQueryList;

function stubMatchMedia(initialMatches: boolean): void {
  mql = new FakeMediaQueryList('(prefers-color-scheme: dark)', initialMatches);
  vi.stubGlobal('matchMedia', vi.fn((query: string) => {
    mql.media = query;
    return mql;
  }));
}

/** Import a FRESH copy of the module (module-level choice/resolved/listeners are singletons —
 *  same reasoning as lib/sound.test.ts's freshSound()). */
async function freshTheme() {
  vi.resetModules();
  return import('../lib/theme.js');
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('theme module', () => {
  it('defaults to dark and stamps <html data-theme="dark"> on a fresh (unconfigured) load', async () => {
    const theme = await freshTheme();
    expect(theme.getThemeChoice()).toBe('dark');
    expect(theme.getResolvedTheme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('a fresh module load respects a PERSISTED choice (same storage key PreferencesHub already used)', async () => {
    window.localStorage.setItem('rc_pref_theme', 'light');
    const theme = await freshTheme();
    expect(theme.getThemeChoice()).toBe('light');
    expect(theme.getResolvedTheme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('setThemeChoice persists dark/light directly and re-stamps <html> globally', async () => {
    const theme = await freshTheme();

    theme.setThemeChoice('light');
    expect(window.localStorage.getItem('rc_pref_theme')).toBe('light');
    expect(theme.getResolvedTheme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    theme.setThemeChoice('dark');
    expect(window.localStorage.getItem('rc_pref_theme')).toBe('dark');
    expect(theme.getResolvedTheme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('system resolves against matchMedia at the moment it is selected (not a stale one-time read)', async () => {
    stubMatchMedia(false); // OS currently light
    const theme = await freshTheme();

    theme.setThemeChoice('system');
    expect(theme.getThemeChoice()).toBe('system');
    expect(theme.getResolvedTheme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem('rc_pref_theme')).toBe('system'); // raw 3-way choice persisted, not the resolved value
  });

  it('system reacts LIVE to an OS prefers-color-scheme change while selected (MediaQueryList "change", not a one-time read)', async () => {
    stubMatchMedia(false); // OS starts light
    const theme = await freshTheme();
    theme.setThemeChoice('system');
    expect(theme.getResolvedTheme()).toBe('light');

    mql.set(true); // OS flips to dark while the app stays open
    expect(theme.getResolvedTheme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    mql.set(false); // and back
    expect(theme.getResolvedTheme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('leaving system for an explicit choice stops watching the OS (no leaked listener)', async () => {
    stubMatchMedia(false);
    const theme = await freshTheme();
    theme.setThemeChoice('system');
    expect(mql.listenerCount).toBe(1);

    theme.setThemeChoice('dark');
    expect(mql.listenerCount).toBe(0);

    mql.set(true); // an OS flip after leaving system must have no effect at all
    expect(theme.getResolvedTheme()).toBe('dark');
  });

  it('subscribeTheme notifies on every choice change and on a live system flip, and unsubscribe stops it', async () => {
    stubMatchMedia(false);
    const theme = await freshTheme();
    const listener = vi.fn();
    const unsub = theme.subscribeTheme(listener);

    theme.setThemeChoice('light');
    expect(listener).toHaveBeenCalledTimes(1);

    theme.setThemeChoice('system');
    expect(listener).toHaveBeenCalledTimes(2);

    mql.set(true);
    expect(listener).toHaveBeenCalledTimes(3);

    unsub();
    mql.set(false);
    expect(listener).toHaveBeenCalledTimes(3); // unsubscribed — no further notifications
  });

  it('falls back to dark if matchMedia is unavailable (older browser / no stub)', async () => {
    // No stubMatchMedia() call — jsdom has no matchMedia by default.
    const theme = await freshTheme();
    theme.setThemeChoice('system');
    expect(theme.getResolvedTheme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
