/**
 * Currency-picker mock data (issue #530, `docs/COMMS/ADVISOR_TO_PM.md` 2026-09-11#5) — literal
 * copies of the prototype's own constants (`design/prototype/RapidClash Full Spec.html:3580-3585`,
 * `:2855` for `OPEN_CURS`). These are display-only mock strings for the picker's SOL/BTC/etc.
 * rows, NEVER derived from the real integer `balance` prop / credits ledger, and never will be —
 * this is the Owner-approved cosmetic currency skin (CHARTER.md #4), and the invariant that this
 * file is the picker's ONLY source of non-USD numbers is load-bearing: nothing in
 * `CurrencyPicker.tsx` may compute any of these values from live balance data.
 *
 * USD is the one exception worth calling out: `CUR_BAL.USD`/`CUR_CRYPTO.USD` below are still the
 * prototype's own literal mock strings (`'$119.20'`/`'119.20'`), copied verbatim like every other
 * entry — they are NOT the real balance either. The picker's *trigger* (in `HubRibbon.tsx`) reads
 * the real `balance` prop directly for its default USD display; only once a user opens this panel
 * and it renders the USD row inside the list does `CUR_BAL.USD` ever appear on screen.
 */

/** Fiat-display mock balances, one string per currency — prototype `:3580`. */
export const CUR_BAL: Record<string, string> = {
  USD: '$119.20',
  BTC: '$0.00',
  ETH: '$0.00',
  USDT: '$837',
  USDC: '$0.00',
  SOL: '$1,642',
  LTC: '$0.00',
  XRP: '$0.00',
};

/** Native-unit mock balances (the "Display in Fiat" toggle's off state) — prototype `:3581`. */
export const CUR_CRYPTO: Record<string, string> = {
  USD: '119.20',
  BTC: '0.00000000',
  ETH: '0.00000000',
  USDT: '837.0',
  USDC: '0.00000000',
  SOL: '10.6483',
  LTC: '0.00000000',
  XRP: '0.00000000',
};

/** Full display names, used by the search filter (symbol OR name substring) — prototype `:3585`. */
export const CUR_NAME: Record<string, string> = {
  USD: 'US Dollar',
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  USDT: 'Tether',
  USDC: 'USD Coin',
  SOL: 'Solana',
  LTC: 'Litecoin',
  XRP: 'XRP Ripple',
};

/**
 * The 7 cryptocurrency rows, in the prototype's own literal order (`:2855`) — NOT alphabetical,
 * keep as-is. USD is not part of this list; it's always its own "Cash" section, rendered
 * separately (prototype `:2249-2256`).
 */
export const OPEN_CURS: string[] = ['SOL', 'BTC', 'USDT', 'ETH', 'LTC', 'USDC', 'XRP'];
