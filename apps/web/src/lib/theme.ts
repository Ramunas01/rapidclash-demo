import { useEffect, useState } from 'react';

/**
 * App-wide theme engine (issue #472 — Theme foundation, T1 of the shared-chrome +
 * light-theme rollout, `docs/NEW_DESIGN_MIGRATION.md`).
 *
 * Replaces `PreferencesHub.tsx`'s old `readTheme`/`pickTheme` pair, which only ever re-themed
 * that screen's own DOM subtree via local `--pref-*` custom properties (its own code comment
 * said so). This module is the single source of truth for theme state for the whole app:
 *  - persists the user's raw 3-way choice under the SAME localStorage key PreferencesHub always
 *    used (`rc_pref_theme`) — no second, competing storage key;
 *  - resolves `system` against `matchMedia('(prefers-color-scheme: dark)')`, reacting live via
 *    the MediaQueryList's `change` event (not a one-time read at load);
 *  - stamps the resolved value on `<html data-theme="...">`, which drives `index.css`'s
 *    `--rc-*` token block for the ENTIRE app, not just one screen.
 *
 * Module-level singleton + subscribe/notify, initialized as a top-level side effect on first
 * import — the same shape as `lib/sound.ts`'s mute module (this app's house pattern for small
 * pieces of global client state; no React Context is used anywhere in `apps/web`). `main.tsx`
 * imports this module directly (for its side effect) before the first `render()`, so `<html>`
 * is stamped ahead of paint — no flash of the wrong theme.
 */

export type ThemeChoice = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

// PreferencesHub.tsx's pre-existing `KEYS.theme` value — kept identical on purpose so a user's
// already-persisted choice keeps working, and so there is exactly one storage key for theme.
const STORAGE_KEY = 'rc_pref_theme';
const SYSTEM_QUERY = '(prefers-color-scheme: dark)';

function readStoredChoice(): ThemeChoice {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === 'light' || raw === 'system' ? raw : 'dark';
  } catch {
    return 'dark';
  }
}

function writeStoredChoice(next: ThemeChoice): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* in-memory state still reflects the choice for this session */
  }
}

function systemPrefersDark(): boolean {
  try {
    // jsdom (unit tests) has no matchMedia unless a test stubs it — fail toward this app's
    // existing dark-first default rather than throwing.
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(SYSTEM_QUERY).matches
      : true;
  } catch {
    return true;
  }
}

function resolve(choiceToResolve: ThemeChoice): ResolvedTheme {
  return choiceToResolve === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : choiceToResolve;
}

/** Stamps <html data-theme="dark"|"light">. index.css's `:root` (dark) and
 *  `:root[data-theme="light"]` blocks key off this attribute to re-theme every screen at once. */
function applyToDocument(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

const listeners = new Set<() => void>();
function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* one bad listener must not break the others */
    }
  }
}

// ── Module-level singleton state — read the persisted choice + stamp the DOM immediately on
// import (mirrors lib/sound.ts's `let muted = ... readMutedPref()`), so theming is correct
// before any component even mounts. ──
let choice: ThemeChoice = typeof window !== 'undefined' ? readStoredChoice() : 'dark';
let resolved: ResolvedTheme = resolve(choice);
applyToDocument(resolved);

let systemMql: MediaQueryList | null = null;
let systemHandler: (() => void) | null = null;

function teardownSystemWatcher(): void {
  if (systemMql && systemHandler) {
    if (typeof systemMql.removeEventListener === 'function') {
      systemMql.removeEventListener('change', systemHandler);
    } else {
      // Safari < 14 only ever exposed the deprecated addListener/removeListener API.
      systemMql.removeListener(systemHandler);
    }
  }
  systemMql = null;
  systemHandler = null;
}

/** Only active while `choice === 'system'`: reacts LIVE to the OS flipping light/dark while the
 *  app stays open (the MediaQueryList `change` event — not a one-time read at load). */
function syncSystemWatcher(): void {
  teardownSystemWatcher();
  if (choice !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  try {
    systemMql = window.matchMedia(SYSTEM_QUERY);
  } catch {
    return;
  }
  systemHandler = () => {
    resolved = systemMql!.matches ? 'dark' : 'light';
    applyToDocument(resolved);
    notify();
  };
  if (typeof systemMql.addEventListener === 'function') {
    systemMql.addEventListener('change', systemHandler);
  } else {
    systemMql.addListener(systemHandler);
  }
}
syncSystemWatcher();

export function getThemeChoice(): ThemeChoice {
  return choice;
}

export function getResolvedTheme(): ResolvedTheme {
  return resolved;
}

/** Sets the user's raw 3-way choice, persists it, re-resolves, re-themes the whole app, and
 *  notifies every subscriber (e.g. every `useTheme()` call anywhere in the tree). */
export function setThemeChoice(next: ThemeChoice): void {
  choice = next;
  writeStoredChoice(next);
  resolved = resolve(choice);
  applyToDocument(resolved);
  syncSystemWatcher();
  notify();
}

/** Subscribe to theme changes (choice flips, or a live system-preference change while `system`
 *  is selected). Returns an unsubscribe function. */
export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React hook: the current 3-way choice, the actually-applied theme, and a setter. Any component
 *  anywhere in the tree can call this — theme state is global, not scoped to one screen. */
export function useTheme(): { choice: ThemeChoice; resolved: ResolvedTheme; setChoice(next: ThemeChoice): void } {
  const [state, setState] = useState(() => ({ choice: getThemeChoice(), resolved: getResolvedTheme() }));
  useEffect(
    () => subscribeTheme(() => setState({ choice: getThemeChoice(), resolved: getResolvedTheme() })),
    [],
  );
  return { choice: state.choice, resolved: state.resolved, setChoice: setThemeChoice };
}
