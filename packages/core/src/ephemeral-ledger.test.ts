import { describe, beforeEach, it, expect } from 'vitest';
import { createEphemeralLedger, GUEST_GRANT_AMOUNT } from './ephemeral-ledger.js';
import { PLATFORM_ACCOUNT } from './ledger.js';

describe('ephemeral ledger', () => {
  let ledger: ReturnType<typeof createEphemeralLedger>;

  beforeEach(() => {
    ledger = createEphemeralLedger();
  });

  // Mirrors ledger.test.ts — the ephemeral ledger implements the SAME Ledger interface as the
  // real one, just in-memory, so its balance/escrow/settle semantics must match exactly.

  it('starting balance equals one GRANT', () => {
    ledger.grant('guest:alice');
    expect(ledger.getBalance('guest:alice')).toBe(GUEST_GRANT_AMOUNT);
  });

  it('unknown account has zero balance', () => {
    expect(ledger.getBalance('nobody')).toBe(0);
  });

  it('escrow reduces balance by the staked amount', () => {
    ledger.grant('guest:alice');
    ledger.escrow('guest:alice', 'match-1', 100);
    expect(ledger.getBalance('guest:alice')).toBe(GUEST_GRANT_AMOUNT - 100);
  });

  it('escrowing more than balance throws', () => {
    ledger.grant('guest:alice');
    expect(() => ledger.escrow('guest:alice', 'match-1', GUEST_GRANT_AMOUNT + 1)).toThrow();
  });

  it('escrowing with zero amount throws', () => {
    ledger.grant('guest:alice');
    expect(() => ledger.escrow('guest:alice', 'match-1', 0)).toThrow();
  });

  it('win settlement: sum across all accounts is zero (money conserved)', () => {
    ledger.grant('guest:alice');
    ledger.grant('demo-bot:coinflip');
    ledger.escrow('guest:alice', 'match-win', 100);
    ledger.escrow('demo-bot:coinflip', 'match-win', 100);

    ledger.settle('match-win', 'win', 'guest:alice', 200, 0.1);

    const alice = ledger.getBalance('guest:alice');
    const bot = ledger.getBalance('demo-bot:coinflip');
    const platform = ledger.getBalance(PLATFORM_ACCOUNT);

    expect(alice).toBe(GUEST_GRANT_AMOUNT - 100 + 180);
    expect(bot).toBe(GUEST_GRANT_AMOUNT - 100);
    expect(platform).toBe(20);
    expect(alice + bot + platform).toBe(2 * GUEST_GRANT_AMOUNT);
  });

  it('draw settlement: each player refunded, no rake, sum is zero', () => {
    ledger.grant('guest:alice');
    ledger.grant('guest:bob');
    ledger.escrow('guest:alice', 'match-draw', 150);
    ledger.escrow('guest:bob', 'match-draw', 150);

    ledger.settle('match-draw', 'draw', undefined, 300, 0.1);

    expect(ledger.getBalance('guest:alice')).toBe(GUEST_GRANT_AMOUNT);
    expect(ledger.getBalance('guest:bob')).toBe(GUEST_GRANT_AMOUNT);
    expect(ledger.getBalance(PLATFORM_ACCOUNT)).toBe(0);
  });

  it('void settlement: each player refunded in full, no rake', () => {
    ledger.grant('guest:alice');
    ledger.grant('guest:bob');
    ledger.escrow('guest:alice', 'match-void', 200);
    ledger.escrow('guest:bob', 'match-void', 200);

    ledger.settle('match-void', 'void', undefined, 400, 0.05);

    expect(ledger.getBalance('guest:alice')).toBe(GUEST_GRANT_AMOUNT);
    expect(ledger.getBalance('guest:bob')).toBe(GUEST_GRANT_AMOUNT);
  });

  it('settle is idempotent: replaying the same match_id is a no-op', () => {
    ledger.grant('guest:alice');
    ledger.grant('guest:bob');
    ledger.escrow('guest:alice', 'match-idem', 100);
    ledger.escrow('guest:bob', 'match-idem', 100);

    ledger.settle('match-idem', 'win', 'guest:alice', 200, 0.1);
    const balanceAfterFirst = ledger.getBalance('guest:alice');
    const entriesAfterFirst = ledger.getEntries('guest:alice').length;

    ledger.settle('match-idem', 'win', 'guest:alice', 200, 0.1);

    expect(ledger.getBalance('guest:alice')).toBe(balanceAfterFirst);
    expect(ledger.getEntries('guest:alice').length).toBe(entriesAfterFirst);
  });

  it('escrow is idempotent: double-tap escrows once', () => {
    ledger.grant('guest:alice');
    ledger.escrow('guest:alice', 'match-esc-idem', 100);
    ledger.escrow('guest:alice', 'match-esc-idem', 100);
    expect(ledger.getBalance('guest:alice')).toBe(GUEST_GRANT_AMOUNT - 100);
  });

  it('grant is idempotent: same account_id grants once', () => {
    ledger.grant('guest:alice');
    ledger.grant('guest:alice');
    expect(ledger.getBalance('guest:alice')).toBe(GUEST_GRANT_AMOUNT);
  });

  it('getEntries returns all entries for an account in order', () => {
    ledger.grant('guest:alice');
    ledger.escrow('guest:alice', 'match-entries', 50);
    const entries = ledger.getEntries('guest:alice');
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe('GRANT');
    expect(entries[1].type).toBe('BET_ESCROW');
    expect(entries[1].matchId).toBe('match-entries');
  });

  describe('hasOpenEscrow', () => {
    it('is true while escrowed and unsettled, false once settled', () => {
      ledger.grant('guest:alice');
      ledger.grant('guest:bob');
      ledger.escrow('guest:alice', 'm', 100);
      ledger.escrow('guest:bob', 'm', 100);
      expect(ledger.hasOpenEscrow('guest:alice')).toBe(true);
      ledger.settle('m', 'win', 'guest:alice', 200, 0.1);
      expect(ledger.hasOpenEscrow('guest:alice')).toBe(false);
      expect(ledger.hasOpenEscrow('guest:bob')).toBe(false);
    });
  });

  // Ephemeral-only behaviour, not part of the shared Ledger contract.

  it('supports a configurable grant amount per instance (guest starting stack != real GRANT_AMOUNT)', () => {
    const custom = createEphemeralLedger({ grantAmount: 12345 });
    custom.grant('guest:x');
    expect(custom.getBalance('guest:x')).toBe(12345);
  });

  it('two guest accounts on the same shared instance are fully isolated', () => {
    ledger.grant('guest:alice');
    ledger.grant('guest:bob');
    ledger.escrow('guest:alice', 'm1', 50);
    expect(ledger.getBalance('guest:alice')).toBe(GUEST_GRANT_AMOUNT - 50);
    expect(ledger.getBalance('guest:bob')).toBe(GUEST_GRANT_AMOUNT); // untouched
    expect(ledger.getEntries('guest:bob')).toHaveLength(1); // only its own GRANT
  });

  it('evict drops every entry for an account, resetting its balance to zero', () => {
    ledger.grant('guest:alice');
    ledger.escrow('guest:alice', 'm', 10);
    ledger.evict('guest:alice');
    expect(ledger.getBalance('guest:alice')).toBe(0);
    expect(ledger.getEntries('guest:alice')).toHaveLength(0);
  });

  it('evicting one account never touches another account sharing a settled match', () => {
    ledger.grant('guest:alice');
    ledger.grant('guest:bob');
    ledger.escrow('guest:alice', 'm', 100);
    ledger.escrow('guest:bob', 'm', 100);
    ledger.settle('m', 'win', 'guest:alice', 200, 0.1);
    ledger.evict('guest:alice');
    expect(ledger.getBalance('guest:bob')).toBe(GUEST_GRANT_AMOUNT - 100);
  });

  it('a re-grant after eviction starts a fresh GRANT (the idempotency key is free again)', () => {
    ledger.grant('guest:alice');
    ledger.evict('guest:alice');
    ledger.grant('guest:alice');
    expect(ledger.getBalance('guest:alice')).toBe(GUEST_GRANT_AMOUNT);
  });
});
