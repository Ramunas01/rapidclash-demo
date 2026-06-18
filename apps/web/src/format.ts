/**
 * The compact display symbol for the play-money unit (credits), shown beside a number
 * like `320¢`. This is a PRESENTATION-ONLY convention (see DEMO_PRESENTATION.md →
 * "Credits display"): the ledger, protocol, schema, and stored values stay plain integer
 * credits — only this file and UI labels use the symbol.
 *
 * Swappable in ONE line. If `¢` doesn't survive the font / owner eyeball, the spec's
 * fallback ladder is: `⚡` → `¤` → `🪙`. Changing this constant updates every display site
 * (and the wordmark below) automatically.
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
