// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';

/**
 * Regression test for the gap Advisor's PR 4 review caught (`docs/COMMS/ADVISOR_TO_PM.md`,
 * 2026-09-28): ticket `2026-09-27#7` (D69) explicitly reverses the earlier USD-default decision
 * (`2026-09-11#5`) now that every currency shows its own real balance, not just USD's — the app's
 * default should match the prototype's own literal `'SOL'` default again. Deliberately its own
 * file, not folded into `CurrencyPicker.test.tsx`: `lib/currency.ts`'s `curSel` is a module-level
 * singleton, and every other test file that touches it explicitly resets it via `setCurSel()`
 * before asserting — this file imports the module fresh and checks its OWN unmodified initial
 * value, before any `setCurSel()` call anywhere has a chance to run first.
 */
describe('lib/currency.ts — default currency', () => {
  it('defaults to SOL (not USD), matching the prototype and ticket 2026-09-27#7\'s own reversal', async () => {
    const { getCurSel } = await import('../lib/currency.js');
    expect(getCurSel()).toBe('SOL');
  });
});
