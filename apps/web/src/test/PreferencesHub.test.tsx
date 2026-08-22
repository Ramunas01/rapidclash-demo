// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PreferencesHubScreen } from '../screens/PreferencesHub.js';
import { isMuted, setMuted } from '../lib/sound.js';

describe('PreferencesHubScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    setMuted(false); // known baseline: sound ON (lib/sound.ts's in-memory state survives across tests in this file)
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

  it('persists the theme choice and rehydrates it on a fresh mount', () => {
    const { unmount } = render(<PreferencesHubScreen onBack={() => {}} />);

    expect(screen.getByTestId('preferences-theme-dark')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('preferences-theme-light'));
    expect(screen.getByTestId('preferences-theme-light')).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('rc_pref_theme')).toBe('light');

    unmount();
    render(<PreferencesHubScreen onBack={() => {}} />);
    expect(screen.getByTestId('preferences-theme-light')).toHaveAttribute('aria-checked', 'true');
  });

  it('scopes the Light theme to this screen only — the document root is untouched', () => {
    render(<PreferencesHubScreen onBack={() => {}} />);

    const rootBg = getComputedStyle(document.documentElement).getPropertyValue('--background');
    fireEvent.click(screen.getByTestId('preferences-theme-light'));

    // The wrapper's own scoped custom properties flip to the light palette...
    const wrapper = screen.getByTestId('preferences-hub');
    expect(wrapper.style.getPropertyValue('--pref-bg')).toBe('#FFFFFF');
    expect(wrapper.style.getPropertyValue('--pref-text')).toBe('#0B0B0B');

    // ...but nothing was written to document.documentElement or any global token.
    expect(document.documentElement.style.getPropertyValue('--background')).toBe('');
    expect(getComputedStyle(document.documentElement).getPropertyValue('--background')).toBe(rootBg);
    expect(document.documentElement.className).not.toMatch(/light/);
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
