import type { Currency } from '@rapidclash/shared';
import { RATE_TABLE, NATIVE_PRECISION } from '@rapidclash/shared';

/**
 * Currency-picker display helpers (issue #530, ticket 2026-09-27#7 D69 PR 4). Through PR 3, every
 * currency here except USD was a hardcoded mock string (CHARTER.md #4's "cosmetic-only currency
 * skin") — Owner-confirmed reversal (2026-09-28): every currency now shows its own REAL balance,
 * the same way USD always has. `fiatDisplay`/`nativeDisplay` are pure display-math built on
 * `packages/shared`'s `RATE_TABLE`/`NATIVE_PRECISION` — the single shared source of truth also used
 * server-side for starting grants, so the two can never drift. Stored ledger amounts are always
 * plain integer USD-equivalent credits; these functions only ever format them for display, never
 * feed into any escrow/settlement math.
 */

/** Fiat display: the stored integer credits, formatted as a dollar figure. Identical for every
 *  currency — the "Display in Fiat" toggle's ON state, and USD's own row regardless of the toggle
 *  (a dollar has no separate native unit). */
export function fiatDisplay(credits: number): string {
  return `$${credits.toLocaleString('en-US')}`;
}

/** Native-unit display: the stored integer credits converted via `RATE_TABLE`, formatted to that
 *  currency's own `NATIVE_PRECISION` decimal places — the "Display in Fiat" toggle's OFF state. */
export function nativeDisplay(currency: Currency, credits: number): string {
  return (credits / RATE_TABLE[currency]).toFixed(NATIVE_PRECISION[currency]);
}

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
