import { describe, it, expect } from 'vitest';
import { CREDIT_SYMBOL, CREDIT_WORDMARK, formatCredits } from '../format.js';

describe('formatCredits', () => {
  it('appends the credit symbol to a plain amount', () => {
    expect(formatCredits(320)).toBe('320¢');
    expect(formatCredits(0)).toBe('0¢');
    expect(formatCredits(1)).toBe('1¢');
  });

  it('preserves negatives for signed values like net_winnings', () => {
    expect(formatCredits(-12)).toBe('-12¢');
    expect(formatCredits(-1)).toBe('-1¢');
  });

  it('groups thousands so balances stay readable', () => {
    expect(formatCredits(1000)).toBe('1,000¢');
    expect(formatCredits(-1234567)).toBe('-1,234,567¢');
  });

  it('uses CREDIT_SYMBOL as the single source of truth (swappable in one line)', () => {
    expect(CREDIT_SYMBOL).toBe('¢');
    // Whatever the symbol is, formatCredits ends with it.
    expect(formatCredits(50).endsWith(CREDIT_SYMBOL)).toBe(true);
  });

  it('derives the labels/headers wordmark from the symbol', () => {
    expect(CREDIT_WORDMARK).toBe('¢redits');
    expect(CREDIT_WORDMARK.startsWith(CREDIT_SYMBOL)).toBe(true);
  });
});
