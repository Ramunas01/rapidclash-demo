/**
 * Ticket 2026-09-27#7 (D69, ADVISOR_TO_PM.md). Real per-currency wallet balances — Option A
 * (genuine independent per-currency ledger buckets), Owner-confirmed as a deliberate reversal of
 * CHARTER.md #4's prior "cosmetic-only currency skin" rule (Option B — one ledger + a computed
 * display conversion — was considered and explicitly rejected: it can't make "switch to USDT,
 * only USDT moves" true, since every currency's number would move together under a single pot).
 *
 * This is the ONE shared source of truth for the starting-balance/rate/precision tables, imported
 * by both the server (ledger starting grants, `packages/core/src/ledger.ts`) and the client
 * (display math, `apps/web/src/components/hub-chrome/currencyData.ts`) — so the two can never
 * drift apart. Stored ledger amounts are always plain integer USD-equivalent credits (never a
 * fractional native unit) — `RATE_TABLE`/`NATIVE_PRECISION` are display-only conversions applied
 * when formatting, never part of any escrow/settlement math.
 */

/** The 8 currencies this app's wallet supports — USD (real, always was) plus the 7 cryptocurrency
 *  rows `currencyData.ts`'s `OPEN_CURS` already lists (kept in that file's own prototype-literal
 *  order for display; this array's own order isn't display-significant). */
export const CURRENCIES = ['USD', 'BTC', 'ETH', 'USDT', 'USDC', 'SOL', 'LTC', 'XRP'] as const;
export type Currency = (typeof CURRENCIES)[number];

/**
 * Integer USD-equivalent credits a brand-new account starts with, per currency. A currency absent
 * from this table implicitly starts at 0 — no ledger row is needed for that case at all, since
 * `getBalance`'s `COALESCE(SUM(amount), 0)` already returns 0 with zero matching rows.
 *
 * USD: 1000 — Owner's own decision (2026-09-28), preserving today's real `GRANT_AMOUNT` /
 * `$1,000` display for the majority-default currency; supersedes the ticket's own literal
 * `$119.20` mock, which predates this feature actually reading a real ledger.
 * SOL: 1642, USDT: 837 — directly derivable from the ticket's own `CUR_BAL` mock table
 * (`currencyData.ts`'s pre-D69 `$1,642`/`$837`), not invented.
 * BTC/ETH/USDC/LTC/XRP: absent (implicitly 0) — the ticket's own mock table shows all five at
 * exactly `$0.00`, both pre- and post-D69; zero is the one thing genuinely NOT in question for
 * these five (only their RATE below was undetermined).
 */
export const STARTING_BALANCE: Partial<Record<Currency, number>> = {
  USD: 1000,
  SOL: 1642,
  USDT: 837,
};

/**
 * Display-only: dollars-worth per one native unit. Converts stored integer credits -> native
 * units for the currency picker's "Display in Fiat" OFF state ONLY — never read by any
 * escrow/settlement/balance-check code path (those always operate on the flat integer credit
 * amount directly, regardless of currency).
 *
 * USD: 1 (identity — a dollar has no separate native unit, matching the picker's own existing
 * "USD row always shows the fiat value regardless of the toggle" rule).
 * SOL: 154.2030, USDT: 1.00 — back-derived from the ticket's own numbers (1642 / 10.6483 =
 * 154.20301832...; 837 / 837.0 = 1.00, correctly a stablecoin) — verified numerically (not just
 * plausible-looking) that dividing `STARTING_BALANCE` by this exact rate reproduces the pre-D69
 * mock's own literal display strings byte-for-byte at `NATIVE_PRECISION`'s own decimal count:
 * `(1642 / 154.2030).toFixed(4)` === `'10.6483'`, the old `CUR_CRYPTO.SOL` mock exactly.
 * BTC/ETH/USDC/LTC/XRP: Advisor's own explicit illustrative placeholder rates (Owner-approved
 * 2026-09-28) — genuinely NOT derivable from any source, since all five start at exactly $0.00
 * in both the ticket's own mock table and the prototype. Chosen only to be realistic-looking
 * order-of-magnitude figures for demo verisimilitude, not real financial data.
 */
export const RATE_TABLE: Record<Currency, number> = {
  USD: 1,
  SOL: 154.203,
  USDT: 1.0,
  BTC: 65000,
  ETH: 2500,
  USDC: 1.0,
  LTC: 70,
  XRP: 0.55,
};

/**
 * Native-unit display decimal precision, matching the pre-D69 mock's own per-currency precision
 * exactly (`currencyData.ts`'s old `CUR_CRYPTO`: SOL `'10.6483'` — 4dp, USDT `'837.0'` — 1dp,
 * everything else `'0.00000000'` — 8dp) — so a currency at its untouched starting balance renders
 * byte-identical to the string it used to show as a hardcoded mock.
 */
export const NATIVE_PRECISION: Record<Currency, number> = {
  USD: 2,
  SOL: 4,
  USDT: 1,
  BTC: 8,
  ETH: 8,
  USDC: 8,
  LTC: 8,
  XRP: 8,
};
