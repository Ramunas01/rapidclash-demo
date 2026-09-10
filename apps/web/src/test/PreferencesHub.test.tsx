// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PreferencesHubScreen } from '../screens/PreferencesHub.js';
import { isMuted, setMuted } from '../lib/sound.js';
import { setThemeChoice } from '../lib/theme.js';

describe('PreferencesHubScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    setMuted(false); // known baseline: sound ON (lib/sound.ts's in-memory state survives across tests in this file)
    // lib/theme.ts is also a module-level singleton shared across every test in this file (same
    // reasoning as lib/sound.ts above) — reset it to a known baseline explicitly, since a plain
    // localStorage.clear() alone doesn't re-read storage into the already-loaded module.
    setThemeChoice('dark');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the header and back button, which navigates to Account', () => {
    const onBack = vi.fn();
    render(<PreferencesHubScreen onBack={onBack} />);

    expect(screen.getByText('Preferences')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('preferences-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders every section with its expected controls', () => {
    render(<PreferencesHubScreen onBack={() => {}} />);

    // Appearance
    expect(screen.getByTestId('preferences-theme-dark')).toBeInTheDocument();
    expect(screen.getByTestId('preferences-theme-light')).toBeInTheDocument();
    expect(screen.getByTestId('preferences-theme-system')).toBeInTheDocument(); // issue #472
    // Sound
    expect(screen.getByTestId('preferences-game-sound')).toBeInTheDocument();
    // Tipping
    expect(screen.getByTestId('preferences-tips')).toBeInTheDocument();
    expect(screen.getByTestId('preferences-tip-notifs')).toBeInTheDocument();
    // Currency
    expect(screen.getByTestId('preferences-cash-display')).toBeInTheDocument();
    expect(screen.getByTestId('preferences-select-currency')).toBeInTheDocument();
    // Privacy
    expect(screen.getByTestId('preferences-stealth')).toBeInTheDocument();
    // Marketing
    expect(screen.getByTestId('preferences-marketing')).toBeInTheDocument();
  });

  it('persists a toggle flip to localStorage and rehydrates it on a fresh mount', () => {
    const { unmount } = render(<PreferencesHubScreen onBack={() => {}} />);

    const stealth = screen.getByTestId('preferences-stealth');
    expect(stealth).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(stealth);
    expect(stealth).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('rc_pref_stealthMode')).toBe('1');

    unmount();

    // A fresh mount reads the persisted value straight back.
    render(<PreferencesHubScreen onBack={() => {}} />);
    expect(screen.getByTestId('preferences-stealth')).toHaveAttribute('aria-checked', 'true');
  });

  it('persists the marketing toggle to localStorage', () => {
    render(<PreferencesHubScreen onBack={() => {}} />);

    const marketing = screen.getByTestId('preferences-marketing');
    expect(marketing).toHaveAttribute('aria-checked', 'true'); // default ON
    fireEvent.click(marketing);
    expect(marketing).toHaveAttribute('aria-checked', 'false');
    expect(localStorage.getItem('rc_pref_marketing')).toBe('0');
  });

  // Issue #418: this toggle used to be decorative — its own separate `rc_pref_gameSound`
  // localStorage key, no live effect. It now controls the app's one real mute module
  // (lib/sound.ts), the same one MuteToggle used to drive from the Account page (moved here,
  // per the design spec — see ProfileHub.test.tsx's "no sound/mute control" regression test).
  it('reflects and controls the real lib/sound.ts mute module', () => {
    render(<PreferencesHubScreen onBack={() => {}} />);

    const sound = screen.getByTestId('preferences-game-sound');
    expect(sound).toHaveAttribute('aria-checked', 'true'); // sound ON == not muted
    expect(isMuted()).toBe(false);

    fireEvent.click(sound);
    expect(sound).toHaveAttribute('aria-checked', 'false'); // sound OFF == muted
    expect(isMuted()).toBe(true); // the real module actually flipped, not a decorative copy
    expect(localStorage.getItem('rc:sound:muted')).toBe('1'); // lib/sound.ts's own persistence key
    expect(localStorage.getItem('rc_pref_gameSound')).toBeNull(); // no redundant second key

    fireEvent.click(sound);
    expect(sound).toHaveAttribute('aria-checked', 'true');
    expect(isMuted()).toBe(false);
  });

  // Regression for issue #418: the row must stay in sync if mute changes from elsewhere (defense
  // in depth via lib/sound.ts's own subscribe() contract — nothing else mutes it today, but the
  // module's subscribe contract exists precisely so this can't silently drift out of sync).
  it('syncs the sound toggle if mute is flipped outside this screen', () => {
    render(<PreferencesHubScreen onBack={() => {}} />);
    const sound = screen.getByTestId('preferences-game-sound');
    expect(sound).toHaveAttribute('aria-checked', 'true');

    act(() => setMuted(true));
    expect(sound).toHaveAttribute('aria-checked', 'false');
  });

  it('persists the theme choice (dark/light/system) and rehydrates it on a fresh mount', () => {
    const { unmount } = render(<PreferencesHubScreen onBack={() => {}} />);

    expect(screen.getByTestId('preferences-theme-dark')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('preferences-theme-light'));
    expect(screen.getByTestId('preferences-theme-light')).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('rc_pref_theme')).toBe('light');

    unmount();
    render(<PreferencesHubScreen onBack={() => {}} />);
    expect(screen.getByTestId('preferences-theme-light')).toHaveAttribute('aria-checked', 'true');

    // System is a real third option, not just Dark/Light (issue #472).
    fireEvent.click(screen.getByTestId('preferences-theme-system'));
    expect(screen.getByTestId('preferences-theme-system')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('preferences-theme-light')).toHaveAttribute('aria-checked', 'false');
    expect(localStorage.getItem('rc_pref_theme')).toBe('system'); // the raw 3-way choice is what's persisted
  });

  // Issue #472: the old mechanism this replaces only ever re-themed PreferencesHub's own DOM
  // subtree (its own code comment said so) -- this asserts the NEW app-wide provider instead, on
  // the one place any screen (not just this one) can read the resolved theme from: <html
  // data-theme>, per the issue's own verification note ("assert on the data-theme attribute...
  // not just on Preferences' own local DOM").
  it('stamps the app-wide <html data-theme> attribute, not just this screen own subtree', () => {
    render(<PreferencesHubScreen onBack={() => {}} />);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    fireEvent.click(screen.getByTestId('preferences-theme-light'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    fireEvent.click(screen.getByTestId('preferences-theme-dark'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  // Issue #472: `system` must react to a LIVE OS preference change while selected (the
  // MediaQueryList `change` event), not just a one-time read at load.
  it('System reacts live to a simulated OS prefers-color-scheme change while selected', () => {
    let changeListener: (() => void) | undefined;
    const fakeMql = {
      matches: false, // OS starts light
      media: '(prefers-color-scheme: dark)',
      addEventListener: (_type: 'change', cb: () => void) => {
        changeListener = cb;
      },
      removeEventListener: () => {
        changeListener = undefined;
      },
      addListener: (cb: () => void) => {
        changeListener = cb;
      },
      removeListener: () => {
        changeListener = undefined;
      },
      dispatchEvent: () => false,
    };
    vi.stubGlobal('matchMedia', vi.fn(() => fakeMql));

    render(<PreferencesHubScreen onBack={() => {}} />);
    fireEvent.click(screen.getByTestId('preferences-theme-system'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light'); // OS was light at selection time

    act(() => {
      fakeMql.matches = true; // OS flips to dark while the app stays open
      changeListener?.();
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    act(() => {
      fakeMql.matches = false;
      changeListener?.();
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('the tipping toggles render but reject interaction (disabled, no state change)', () => {
    render(<PreferencesHubScreen onBack={() => {}} />);

    const tips = screen.getByTestId('preferences-tips');
    const tipNotifs = screen.getByTestId('preferences-tip-notifs');
    expect(tips).toBeDisabled();
    expect(tipNotifs).toBeDisabled();

    const tipsBefore = tips.getAttribute('aria-checked');
    const notifsBefore = tipNotifs.getAttribute('aria-checked');
    fireEvent.click(tips);
    fireEvent.click(tipNotifs);
    expect(tips).toHaveAttribute('aria-checked', tipsBefore);
    expect(tipNotifs).toHaveAttribute('aria-checked', notifsBefore);
    // Disabled toggles must never write a preference from a click.
    expect(localStorage.getItem('rc_pref_tips')).toBeNull();
    expect(localStorage.getItem('rc_pref_tipNotifsDisabled')).toBeNull();
  });

  it('the currency row is inert while cash-value is off, and becomes interactive once it is on', () => {
    render(<PreferencesHubScreen onBack={() => {}} />);

    const cash = screen.getByTestId('preferences-cash-display');
    const selectRow = screen.getByTestId('preferences-select-currency');
    expect(cash).toHaveAttribute('aria-checked', 'false'); // default OFF
    expect(selectRow).toBeDisabled();

    // Clicking while disabled does nothing — no grid appears.
    fireEvent.click(selectRow);
    expect(screen.queryByTestId('preferences-currency-grid')).not.toBeInTheDocument();

    // Turning cash display on makes the row interactive.
    fireEvent.click(cash);
    expect(cash).toHaveAttribute('aria-checked', 'true');
    expect(selectRow).not.toBeDisabled();

    fireEvent.click(selectRow);
    expect(screen.getByTestId('preferences-currency-grid')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('preferences-currency-EUR'));
    expect(screen.getByTestId('preferences-select-currency')).toHaveTextContent('EUR');
    expect(localStorage.getItem('rc_pref_currency')).toBe('EUR');
    // Picking a currency closes the grid.
    expect(screen.queryByTestId('preferences-currency-grid')).not.toBeInTheDocument();

    // Turning cash display back off dims/disables the row again.
    fireEvent.click(cash);
    expect(screen.getByTestId('preferences-select-currency')).toBeDisabled();
  });
});
