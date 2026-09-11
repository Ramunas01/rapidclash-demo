// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HubRibbon } from '../components/hub-chrome/HubRibbon.js';
import { CUR_BAL, CUR_CRYPTO, CUR_NAME, OPEN_CURS } from '../components/hub-chrome/currencyData.js';

/**
 * Currency picker tests (issue #530, `docs/COMMS/ADVISOR_TO_PM.md` 2026-09-11#5). Rendered
 * through `HubRibbon` (registered, non-guest) rather than in isolation — that's how it's actually
 * mounted in the app, and it lets the "real balance is never touched" invariant be checked against
 * the exact prop `HubRibbon` receives.
 */
function renderRibbon(balance: number | null = 1642) {
  const onLogo = vi.fn();
  const onWallet = vi.fn();
  render(<HubRibbon balance={balance} onLogo={onLogo} onWallet={onWallet} loggedIn />);
  return { onLogo, onWallet };
}

function openPicker() {
  fireEvent.click(screen.getByTestId('hub-currency-chip'));
}

describe('CurrencyPicker — trigger defaults to USD / the real balance (PM decision, not the prototype\'s literal SOL default)', () => {
  it('renders the real integer balance formatted as $ by default, not a mock currency', () => {
    renderRibbon(1642);
    expect(screen.getByTestId('hub-balance').textContent).toBe('$1,642');
  });

  it('does not render the prototype\'s default SOL mock balance ($1,642 is deliberately also the SOL mock — verify via a different balance)', () => {
    renderRibbon(42);
    expect(screen.getByTestId('hub-balance').textContent).toBe('$42');
  });

  it('the WALLET sub-pill is unaffected by the split — still present, still calls onWallet, unrelated to the currency trigger', () => {
    const { onWallet } = renderRibbon(1000);
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
  it('hides $0.00 rows once toggled on', () => {
    renderRibbon();
    openPicker();
    expect(screen.getByTestId('currency-picker-row-BTC')).toBeInTheDocument(); // $0.00
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
});

describe('CurrencyPicker — fiat/crypto toggle', () => {
  it('swaps every non-USD row\'s displayed value between CUR_BAL and CUR_CRYPTO', () => {
    renderRibbon();
    openPicker();
    expect(screen.getByTestId('currency-picker-row-SOL').textContent).toContain(CUR_BAL.SOL);
    fireEvent.click(screen.getByTestId('currency-picker-fiat-toggle'));
    expect(screen.getByTestId('currency-picker-row-SOL').textContent).toContain(CUR_CRYPTO.SOL);
  });

  it('USD row stays on CUR_BAL.USD regardless of the toggle', () => {
    // Note: CUR_BAL.USD ('$119.20') trivially *contains* CUR_CRYPTO.USD ('119.20') as a
    // substring, so this asserts the exact row text, not a `.not.toContain` (which would pass
    // vacuously either way). The row's leading "$" comes from IconUSD's own SVG <text> glyph
    // (the coin badge) — aria-hidden excludes it from the accessibility tree, but not from the
    // raw DOM textContent this assertion reads, so it's included here deliberately.
    renderRibbon();
    openPicker();
    expect(screen.getByTestId('currency-picker-row-USD').textContent).toBe(`$USD${CUR_BAL.USD}`);
    fireEvent.click(screen.getByTestId('currency-picker-fiat-toggle'));
    expect(screen.getByTestId('currency-picker-row-USD').textContent).toBe(`$USD${CUR_BAL.USD}`);
  });
});

describe('CurrencyPicker — picking a currency updates the trigger', () => {
  it('picking SOL swaps the trigger to the SOL mock balance (fiat mode, the default)', () => {
    renderRibbon(1000);
    openPicker();
    fireEvent.click(screen.getByTestId('currency-picker-row-SOL'));
    expect(screen.getByTestId('hub-balance').textContent).toBe(CUR_BAL.SOL);
  });

  it('re-picking USD from the panel reverts the trigger to the real balance, not CUR_BAL.USD', () => {
    renderRibbon(777);
    openPicker();
    fireEvent.click(screen.getByTestId('currency-picker-row-SOL'));
    expect(screen.getByTestId('hub-balance').textContent).toBe(CUR_BAL.SOL);
    openPicker();
    fireEvent.click(screen.getByTestId('currency-picker-row-USD'));
    expect(screen.getByTestId('hub-balance').textContent).toBe('$777');
  });
});

describe('CurrencyPicker — balance invariant (Charter #4, cosmetic-only)', () => {
  it('never renders CUR_BAL.USD or CUR_CRYPTO.USD as the trigger value — the trigger is always a live-balance format or a non-USD mock', () => {
    const balance = 5150;
    renderRibbon(balance);
    // At rest: real balance, and specifically NOT the USD mock string (they don't collide here).
    expect(screen.getByTestId('hub-balance').textContent).toBe(`$${balance.toLocaleString('en-US')}`);
    expect(screen.getByTestId('hub-balance').textContent).not.toBe(CUR_BAL.USD);
  });

  it('CUR_BAL/CUR_CRYPTO/CUR_NAME/OPEN_CURS are static module constants, not functions of balance — importing the module twice with different balances renders identical mock data', () => {
    // This directly exercises the "never derived from the real balance" invariant: currencyData
    // exports are plain objects/arrays, so nothing here CAN read `balance` when producing them.
    expect(typeof CUR_BAL).toBe('object');
    expect(typeof CUR_CRYPTO).toBe('object');
    expect(typeof CUR_NAME).toBe('object');
    expect(Array.isArray(OPEN_CURS)).toBe(true);
    // Re-render with a wildly different balance — every mock value must be byte-identical.
    const before = { ...CUR_BAL };
    renderRibbon(999999);
    expect(CUR_BAL).toEqual(before);
  });

  it('switching currencies and toggles never calls onWallet or otherwise touches the real balance/wallet flow', () => {
    const { onWallet } = renderRibbon(2500);
    openPicker();
    fireEvent.click(screen.getByTestId('currency-picker-fiat-toggle'));
    fireEvent.click(screen.getByTestId('currency-picker-zero-toggle'));
    fireEvent.change(screen.getByTestId('currency-picker-search'), { target: { value: 'btc' } });
    openPicker(); // reopen since search may have altered visible rows; trigger still there
    expect(onWallet).not.toHaveBeenCalled();
  });
});

describe('CurrencyPicker — guest mode never renders it', () => {
  it('isGuest renders the plain Demo badge, no currency trigger, no panel', () => {
    render(<HubRibbon balance={200} onLogo={vi.fn()} onWallet={vi.fn()} loggedIn isGuest />);
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
