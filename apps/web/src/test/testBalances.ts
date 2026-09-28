import type { Currency } from '@rapidclash/shared';

/** Ticket 2026-09-27#7 (D69), PR 3: test fixtures used to construct a bare `balance: N` literal —
 *  every screen's own `balances` prop is now the full per-currency map. This builds that map with
 *  `usd` in the USD slot and every other currency at 0 (matching a fresh account that has never
 *  touched a non-USD bucket), so existing test assertions (which only ever cared about the USD
 *  figure) stay byte-identical to their pre-D69 intent. */
export function balancesOf(usd: number): Record<Currency, number> {
  return { USD: usd, BTC: 0, ETH: 0, USDT: 0, USDC: 0, SOL: 0, LTC: 0, XRP: 0 };
}
