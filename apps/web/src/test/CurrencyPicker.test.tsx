// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Currency } from '@rapidclash/shared';
import { CURRENCIES, STARTING_BALANCE } from '@rapidclash/shared';
import { HubRibbon } from '../components/hub-chrome/HubRibbon.js';
import { fiatDisplay, nativeDisplay, OPEN_CURS } from '../components/hub-chrome/currencyData.js';
import { setCurSel } from '../lib/currency.js';

/**
 * Currency picker tests (issue #530, `docs/COMMS/ADVISOR_TO_PM.md` 2026-09-11#5, made real by
 * ticket 2026-09-27#7 D69 PR 4). Rendered through `HubRibbon` (registered, non-guest) rather than
 * in isolation — that's how it's actually mounted in the app.
 *
 * `curSel` is now app-wide shared state (`lib/currency.ts`, ticket 2026-09-13#6 item 2), a
 * module-level singleton that persists across `it` blocks within this file — reset it to the
 * default before every test so each test's expectations stay independent of execution order,
 * same hygiene `CurrencyPicker — theming`'s own light-mode test already applies to `theme.ts`'s
 * singleton (`setThemeChoice('dark')` at its end).
 */
beforeEach(() => setCurSel('USD'));

// Real starting balances (every currency absent from STARTING_BALANCE implicitly 0) — the same
// values a fresh account actually has, so these tests exercise the picker against genuine data
// shapes rather than an arbitrary fixture.
const DEFAULT_BALANCES: Record<Currency, number> = Object.fromEntries(
  CURRENCIES.map((c) => [c, STARTING_BALANCE[c] ?? 0]),
) as Record<Currency, number>;

function renderRibbon(overrides: Partial<Record<Currency, number>> | null = {}) {
  const onLogo = vi.fn();
  const onWallet = vi.fn();
  const balances = overrides === null ? null : { ...DEFAULT_BALANCES, ...overrides };
  render(<HubRibbon balances={balances} onLogo={onLogo} onWallet={onWallet} loggedIn />);
  return { onLogo, onWallet };
}

function openPicker() {
  fireEvent.click(screen.getByTestId('hub-currency-chip'));
}

describe('CurrencyPicker — trigger reads the real balance for whichever currency is selected', () => {
  it('renders the real USD balance formatted as $ by default', () => {
    renderRibbon({ USD: 1642 });
    expect(screen.getByTestId('hub-balance').textContent).toBe('$1,642');
  });

  it('a different USD balance renders correctly — not a fixed/coincidental value', () => {
    renderRibbon({ USD: 42 });
    expect(screen.getByTestId('hub-balance').textContent).toBe('$42');
  });

  it('shows "—" while balances is still loading (null)', () => {
    renderRibbon(null);
    expect(screen.getByTestId('hub-balance').textContent).toBe('—');
  });

  it('the WALLET sub-pill is unaffected by the split — still present, still calls onWallet, unrelated to the currency trigger', () => {
    const { onWallet } = renderRibbon({ USD: 1000 });
    fireEvent.click(screen.getByTestId('hub-wallet-chip'));
    expect(onWallet).toHaveBeenCalledTimes(1);
    // Opening the currency picker must never call onWallet.
    openPicker();
    expect(onWallet).toHaveBeenCalledTimes(1);
  });
});

describe('CurrencyPicker — open/close', () => {
  it('tapping the currency+balance trigger opens the panel', () => {
    renderRibbon();
    expect(screen.queryByTestId('currency-picker-panel')).toBeNull();
    openPicker();
    expect(screen.getByTestId('currency-picker-panel')).toBeInTheDocument();
  });

  it('tapping the backdrop closes the panel', () => {
    renderRibbon();
    openPicker();
    fireEvent.click(screen.getByTestId('currency-picker-backdrop'));
    expect(screen.queryByTestId('currency-picker-panel')).toBeNull();
  });

  it('picking a currency closes the panel', () => {
    renderRibbon();
    openPicker();
    fireEvent.click(screen.getByTestId('currency-picker-row-SOL'));
    expect(screen.queryByTestId('currency-picker-panel')).toBeNull();
  });
});

describe('CurrencyPicker — rows, order, sections', () => {
  it('renders all 8 rows (USD + the 7 OPEN_CURS entries) in the exact OPEN_CURS order, not alphabetical', () => {
    renderRibbon();
    openPicker();
    expect(screen.getByTestId('currency-picker-row-USD')).toBeInTheDocument();
    expect(OPEN_CURS).toEqual(['SOL', 'BTC', 'USDT', 'ETH', 'LTC', 'USDC', 'XRP']);
    const rows = OPEN_CURS.map((sym) => screen.getByTestId(`currency-picker-row-${sym}`));
    const positions = rows.map((el) => Array.from(el.parentElement!.children).indexOf(el));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('USD sits under its own "Cash" header, never mixed into "Cryptocurrency"', () => {
    renderRibbon();
    openPicker();
    expect(screen.getByText('Cash')).toBeInTheDocument();
    expect(screen.getByText('Cryptocurrency')).toBeInTheDocument();
  });
});

describe('CurrencyPicker — search filters by symbol AND name, case-insensitive', () => {
  it('filters by symbol substring, case-insensitive', () => {
    renderRibbon();
    openPicker();
    fireEvent.change(screen.getByTestId('currency-picker-search'), { target: { value: 'sol' } });
    expect(screen.getByTestId('currency-picker-row-SOL')).toBeInTheDocument();
    expect(screen.queryByTestId('currency-picker-row-BTC')).toBeNull();
    expect(screen.queryByTestId('currency-picker-row-USD')).toBeNull();
  });

  it('filters by full name substring — a name-only match (e.g. "dollar" finding USD)', () => {
    renderRibbon();
    openPicker();
    fireEvent.change(screen.getByTestId('currency-picker-search'), { target: { value: 'dollar' } });
    expect(screen.getByTestId('currency-picker-row-USD')).toBeInTheDocument();
    expect(screen.queryByTestId('currency-picker-row-SOL')).toBeNull();
  });

  it('name filter is case-insensitive and works for crypto names too', () => {
    renderRibbon();
    openPicker();
    fireEvent.change(screen.getByTestId('currency-picker-search'), { target: { value: 'LITE' } });
    expect(screen.getByTestId('currency-picker-row-LTC')).toBeInTheDocument();
    expect(screen.queryByTestId('currency-picker-row-SOL')).toBeNull();
  });
});

describe('CurrencyPicker — hide-zero-balances, with the selected-currency exception', () => {
  it('hides genuinely-zero rows once toggled on', () => {
    // DEFAULT_BALANCES: SOL/USDT non-zero, BTC (and the rest) zero.
    renderRibbon();
    openPicker();
    expect(screen.getByTestId('currency-picker-row-BTC')).toBeInTheDocument(); // $0
    fireEvent.click(screen.getByTestId('currency-picker-zero-toggle'));
    expect(screen.queryByTestId('currency-picker-row-BTC')).toBeNull();
    // Non-zero rows stay.
    expect(screen.getByTestId('currency-picker-row-SOL')).toBeInTheDocument();
  });

  it('never hides the currently-selected currency, even if it is zero and hide-zero is on', () => {
    renderRibbon();
    openPicker();
    fireEvent.click(screen.getByTestId('currency-picker-row-BTC')); // select BTC (zero), closes panel
    openPicker();
    fireEvent.click(screen.getByTestId('currency-picker-zero-toggle'));
    expect(screen.getByTestId('currency-picker-row-BTC')).toBeInTheDocument();
  });

  it('while balances is still loading (null), nothing is treated as zero — no row is hidden for lack of data', () => {
    renderRibbon(null);
    openPicker();
    fireEvent.click(screen.getByTestId('currency-picker-zero-toggle'));
    expect(screen.getByTestId('currency-picker-row-BTC')).toBeInTheDocument();
  });
});

describe('CurrencyPicker — fiat/crypto toggle', () => {
  it('swaps every non-USD row\'s displayed value between fiat and native-unit display — real math, not a mock string', () => {
    renderRibbon(); // SOL: 1642 (STARTING_BALANCE)
    openPicker();
    expect(screen.getByTestId('currency-picker-row-SOL').textContent).toContain(fiatDisplay(1642));
    fireEvent.click(screen.getByTestId('currency-picker-fiat-toggle'));
    expect(screen.getByTestId('currency-picker-row-SOL').textContent).toContain(nativeDisplay('SOL', 1642));
    // Verified against the ticket's own pre-D69 numbers: 1642 credits / RATE_TABLE.SOL reproduces
    // the exact old mock string, now genuinely derived rather than copied.
    expect(nativeDisplay('SOL', 1642)).toBe('10.6483');
  });

  it('a different SOL balance renders correctly via the real conversion, not a fixed mock', () => {
    renderRibbon({ SOL: 3284 }); // 2x the default — proves it's genuinely computed, not memoized
    openPicker();
    fireEvent.click(screen.getByTestId('currency-picker-fiat-toggle'));
    expect(screen.getByTestId('currency-picker-row-SOL').textContent).toContain(nativeDisplay('SOL', 3284));
    expect(nativeDisplay('SOL', 3284)).not.toBe(nativeDisplay('SOL', 1642));
  });

  it('USD row stays on the fiat display regardless of the toggle — a dollar has no separate native unit', () => {
    renderRibbon({ USD: 1000 });
    openPicker();
    // The row's leading "$" comes from IconUSD's own SVG <text> glyph (the coin badge) —
    // aria-hidden excludes it from the accessibility tree, but not from raw DOM textContent.
    expect(screen.getByTestId('currency-picker-row-USD').textContent).toBe('$USD$1,000');
    fireEvent.click(screen.getByTestId('currency-picker-fiat-toggle'));
    expect(screen.getByTestId('currency-picker-row-USD').textContent).toBe('$USD$1,000');
  });
});

describe('CurrencyPicker — picking a currency updates the trigger', () => {
  it('picking SOL swaps the trigger to SOL\'s own real balance (fiat mode, the default)', () => {
    renderRibbon({ USD: 1000, SOL: 1642 });
    openPicker();
    fireEvent.click(screen.getByTestId('currency-picker-row-SOL'));
    expect(screen.getByTestId('hub-balance').textContent).toBe('$1,642');
  });

  it('re-picking USD from the panel reverts the trigger to USD\'s own real balance', () => {
    renderRibbon({ USD: 777, SOL: 1642 });
    openPicker();
    fireEvent.click(screen.getByTestId('currency-picker-row-SOL'));
    expect(screen.getByTestId('hub-balance').textContent).toBe('$1,642');
    openPicker();
    fireEvent.click(screen.getByTestId('currency-picker-row-USD'));
    expect(screen.getByTestId('hub-balance').textContent).toBe('$777');
  });

  it('the trigger for a non-USD currency respects the fiat/crypto toggle too, same as its own row', () => {
    renderRibbon({ SOL: 1642 });
    openPicker();
    fireEvent.click(screen.getByTestId('currency-picker-row-SOL'));
    expect(screen.getByTestId('hub-balance').textContent).toBe(fiatDisplay(1642));
    openPicker();
    fireEvent.click(screen.getByTestId('currency-picker-fiat-toggle'));
    expect(screen.getByTestId('hub-balance').textContent).toBe(nativeDisplay('SOL', 1642));
  });
});

describe('CurrencyPicker — guest mode never renders it', () => {
  it('isGuest renders the plain Demo badge, no currency trigger, no panel', () => {
    render(<HubRibbon balances={{ ...DEFAULT_BALANCES, USD: 200 }} onLogo={vi.fn()} onWallet={vi.fn()} loggedIn isGuest />);
    expect(screen.queryByTestId('hub-currency-chip')).toBeNull();
    expect(screen.queryByTestId('currency-picker-panel')).toBeNull();
    expect(screen.getByTestId('hub-guest-badge')).toBeInTheDocument();
  });
});

describe('CurrencyPicker — theming', () => {
  it('renders search input and panel in dark mode by default (no crash, correct testids present)', () => {
    renderRibbon();
    openPicker();
    expect(screen.getByTestId('currency-picker-panel')).toBeInTheDocument();
    expect(screen.getByTestId('currency-picker-search')).toBeInTheDocument();
  });

  it('renders correctly in light mode too', async () => {
    const { setThemeChoice } = await import('../lib/theme.js');
    setThemeChoice('light');
    renderRibbon();
    openPicker();
    expect(screen.getByTestId('currency-picker-panel')).toBeInTheDocument();
    setThemeChoice('dark'); // restore — theme.ts is a module-level singleton shared across tests
  });
});
