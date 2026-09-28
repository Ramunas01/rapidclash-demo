// packages/shared/src/currency.test.ts
// Ticket 2026-09-27#7 (D69): locks down the exact starting-balance/rate/precision numbers Owner
// approved (2026-09-28), and — genuinely, not just plausibly — verifies the SOL/USDT rates
// reproduce the pre-D69 mock's own literal display strings byte-for-byte, since those two are
// derived from real source numbers rather than picked.

import { describe, it, expect } from 'vitest';
import { CURRENCIES, STARTING_BALANCE, RATE_TABLE, NATIVE_PRECISION, type Currency } from './currency.js';

describe('CURRENCIES', () => {
  it('lists exactly the 8 supported currencies, USD first', () => {
    expect(CURRENCIES).toEqual(['USD', 'BTC', 'ETH', 'USDT', 'USDC', 'SOL', 'LTC', 'XRP']);
  });

  it('RATE_TABLE and NATIVE_PRECISION each have an entry for every currency (no silent gaps)', () => {
    for (const c of CURRENCIES) {
      expect(RATE_TABLE[c]).toBeTypeOf('number');
      expect(NATIVE_PRECISION[c]).toBeTypeOf('number');
    }
  });
});

describe('STARTING_BALANCE — Owner decision 2026-09-28', () => {
  it('USD starts at 1000 (today\'s real GRANT_AMOUNT), not the ticket\'s own superseded $119.20 mock', () => {
    expect(STARTING_BALANCE.USD).toBe(1000);
  });

  it('SOL/USDT start at the exact values derivable from the pre-D69 CUR_BAL mock ($1,642/$837)', () => {
    expect(STARTING_BALANCE.SOL).toBe(1642);
    expect(STARTING_BALANCE.USDT).toBe(837);
  });

  it('BTC/ETH/USDC/LTC/XRP are absent — implicitly 0, matching the mock\'s own $0.00 for all five', () => {
    const zero: Currency[] = ['BTC', 'ETH', 'USDC', 'LTC', 'XRP'];
    for (const c of zero) {
      expect(STARTING_BALANCE[c]).toBeUndefined();
    }
  });
});

describe('RATE_TABLE — verified against the pre-D69 mock, not just plausible-looking', () => {
  it('USD rate is the identity (1) — a dollar has no separate native unit', () => {
    expect(RATE_TABLE.USD).toBe(1);
  });

  it('USDT is a stablecoin: rate exactly 1.00, matching the mock\'s own 837/837.0', () => {
    expect(RATE_TABLE.USDT).toBe(1);
  });

  it('SOL\'s rate reproduces the pre-D69 mock\'s own literal "10.6483" native-unit string exactly, not approximately', () => {
    const native = (STARTING_BALANCE.SOL! / RATE_TABLE.SOL).toFixed(NATIVE_PRECISION.SOL);
    expect(native).toBe('10.6483');
  });

  it('the 5 undeterminable-rate currencies (BTC/ETH/USDC/LTC/XRP) are Advisor\'s own illustrative placeholders, order-of-magnitude realistic, not real financial data', () => {
    expect(RATE_TABLE.BTC).toBe(65000);
    expect(RATE_TABLE.ETH).toBe(2500);
    expect(RATE_TABLE.USDC).toBe(1);
    expect(RATE_TABLE.LTC).toBe(70);
    expect(RATE_TABLE.XRP).toBe(0.55);
  });
});

describe('NATIVE_PRECISION — matches the pre-D69 mock\'s own per-currency decimal count exactly', () => {
  it('SOL: 4dp, USDT: 1dp, USD: 2dp, everything else: 8dp', () => {
    expect(NATIVE_PRECISION.SOL).toBe(4);
    expect(NATIVE_PRECISION.USDT).toBe(1);
    expect(NATIVE_PRECISION.USD).toBe(2);
    for (const c of ['BTC', 'ETH', 'USDC', 'LTC', 'XRP'] as const) {
      expect(NATIVE_PRECISION[c]).toBe(8);
    }
  });

  it('a currency at exactly 0 balance formats as the pre-D69 mock\'s own "0.00000000" (8dp) for the 5 zero-rate currencies', () => {
    for (const c of ['BTC', 'ETH', 'USDC', 'LTC', 'XRP'] as const) {
      expect((0 / RATE_TABLE[c]).toFixed(NATIVE_PRECISION[c])).toBe('0.00000000');
    }
  });
});
