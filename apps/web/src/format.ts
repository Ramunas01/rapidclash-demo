/**
 * The compact display symbol for the play-money unit (credits), historically shown beside a
 * number like `320¢`. PRESENTATION-ONLY (see DEMO_PRESENTATION.md → "Credits display"): the
 * ledger, protocol, schema, and stored values stay plain integer credits regardless of how this
 * file formats them.
 *
 * Post-#324 role: every *visible* JSX credits display now uses the `<Credits>` component
 * (`components/hub-shared/RcIcon.tsx`), which renders an RC coin icon + plain numeral instead of
 * interpolating this symbol into a string — an icon can't live inside a string, so
 * `formatCredits`'s one-line-swappable design (this constant's original purpose) stopped being
 * how the app actually displays a balance. `CREDIT_SYMBOL`/`formatCredits` remain exactly as
 * before for non-visual/plain-text contexts only: unit tests, and any string that is genuinely
 * text (not rendered next to the RC icon) — e.g. log lines or copy that isn't JSX-rendered credits
 * UI. Don't reach for these in new JSX; reach for `<Credits>`.
 */
export const CREDIT_SYMBOL = '¢';

/**
 * Wordmark for labels/headers only (the spec's `¢redits` play) — NEVER beside a number
 * ("50 ¢redits" reads as broken; use `formatCredits` / `CREDIT_SYMBOL` there instead).
 * Derived from the symbol so it swaps in lockstep.
 */
export const CREDIT_WORDMARK = `${CREDIT_SYMBOL}redits`;

/**
 * Format an integer credit amount as the inline unit, e.g. `formatCredits(320) → "320¢"`.
 * Negatives are preserved for signed values like net_winnings (`-12¢`). Thousands are
 * grouped so balances read as `1,000¢` (en-US for deterministic, locale-independent output).
 * The caller adds an explicit `+` for positive signed values where the sign matters.
 */
export function formatCredits(n: number): string {
  return `${n.toLocaleString('en-US')}${CREDIT_SYMBOL}`;
}

/** Format a millisecond duration as M:SS, clamped at 0 (a countdown never goes negative). */
export function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
