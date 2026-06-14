import { describe, beforeEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createLedger, GRANT_AMOUNT, PLATFORM_ACCOUNT } from './ledger.js';

describe('ledger', () => {
  let ledger: ReturnType<typeof createLedger>;

  beforeEach(() => {
    ledger = createLedger(new Database(':memory:'));
  });

  it('starting balance equals one GRANT', () => {
    ledger.grant('alice');
    expect(ledger.getBalance('alice')).toBe(GRANT_AMOUNT);
  });

  it('unknown account has zero balance', () => {
    expect(ledger.getBalance('nobody')).toBe(0);
  });

  it('escrow reduces balance by the staked amount', () => {
    ledger.grant('alice');
    ledger.escrow('alice', 'match-1', 100);
    expect(ledger.getBalance('alice')).toBe(GRANT_AMOUNT - 100);
  });

  it('escrowing more than balance throws', () => {
    ledger.grant('alice');
    expect(() => ledger.escrow('alice', 'match-1', GRANT_AMOUNT + 1)).toThrow();
  });

  it('escrowing with zero amount throws', () => {
    ledger.grant('alice');
    expect(() => ledger.escrow('alice', 'match-1', 0)).toThrow();
  });

  it('win settlement: sum across all accounts is zero (money conserved)', () => {
    ledger.grant('alice');
    ledger.grant('bob');
    ledger.escrow('alice', 'match-win', 100);
    ledger.escrow('bob', 'match-win', 100);

    // pot = 200, feeRate = 10% → rake = 20, winner gets 180
    ledger.settle('match-win', 'win', 'alice', 200, 0.1);

    const alice = ledger.getBalance('alice');
    const bob = ledger.getBalance('bob');
    const platform = ledger.getBalance(PLATFORM_ACCOUNT);

    // alice: 900 (after escrow) + 180 (win) = 1080
    // bob:   900 (after escrow, no settlement credit)
    // platform: 20 (rake)
    expect(alice).toBe(1080);
    expect(bob).toBe(900);
    expect(platform).toBe(20);
    // Conservation: total equals sum of all grants
    expect(alice + bob + platform).toBe(2 * GRANT_AMOUNT);
  });

  it('draw settlement: each player refunded, no rake, sum is zero', () => {
    ledger.grant('alice');
    ledger.grant('bob');
    ledger.escrow('alice', 'match-draw', 150);
    ledger.escrow('bob', 'match-draw', 150);

    ledger.settle('match-draw', 'draw', undefined, 300, 0.1);

    const alice = ledger.getBalance('alice');
    const bob = ledger.getBalance('bob');
    const platform = ledger.getBalance(PLATFORM_ACCOUNT);

    expect(alice).toBe(GRANT_AMOUNT);
    expect(bob).toBe(GRANT_AMOUNT);
    expect(platform).toBe(0);
    expect(alice + bob + platform).toBe(2 * GRANT_AMOUNT);
  });

  it('void settlement: each player refunded in full, no rake', () => {
    ledger.grant('alice');
    ledger.grant('bob');
    ledger.escrow('alice', 'match-void', 200);
    ledger.escrow('bob', 'match-void', 200);

    ledger.settle('match-void', 'void', undefined, 400, 0.05);

    expect(ledger.getBalance('alice')).toBe(GRANT_AMOUNT);
    expect(ledger.getBalance('bob')).toBe(GRANT_AMOUNT);
    expect(ledger.getBalance(PLATFORM_ACCOUNT)).toBe(0);
  });

  it('settle is idempotent: replaying the same match_id is a no-op', () => {
    ledger.grant('alice');
    ledger.grant('bob');
    ledger.escrow('alice', 'match-idem', 100);
    ledger.escrow('bob', 'match-idem', 100);

    ledger.settle('match-idem', 'win', 'alice', 200, 0.1);
    const balanceAfterFirst = ledger.getBalance('alice');
    const entriesAfterFirst = ledger.getEntries('alice').length;

    ledger.settle('match-idem', 'win', 'alice', 200, 0.1);

    expect(ledger.getBalance('alice')).toBe(balanceAfterFirst);
    expect(ledger.getEntries('alice').length).toBe(entriesAfterFirst);
  });

  it('escrow is idempotent: double-tap escrows once', () => {
    ledger.grant('alice');
    ledger.escrow('alice', 'match-esc-idem', 100);
    ledger.escrow('alice', 'match-esc-idem', 100); // same key — no-op
    expect(ledger.getBalance('alice')).toBe(GRANT_AMOUNT - 100);
  });

  it('getEntries returns all entries for an account in order', () => {
    ledger.grant('alice');
    ledger.escrow('alice', 'match-entries', 50);
    const entries = ledger.getEntries('alice');
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe('GRANT');
    expect(entries[1].type).toBe('BET_ESCROW');
    expect(entries[1].matchId).toBe('match-entries');
  });

  it('grant is idempotent: same account_id grants once', () => {
    ledger.grant('alice');
    ledger.grant('alice'); // duplicate — ignored
    expect(ledger.getBalance('alice')).toBe(GRANT_AMOUNT);
  });
});
