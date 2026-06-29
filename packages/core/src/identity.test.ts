import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createLedger, GRANT_AMOUNT } from './ledger.js';
import { createIdentity } from './identity.js';

function makeServices() {
  const db = new Database(':memory:');
  const ledger = createLedger(db);
  const identity = createIdentity(db, ledger);
  return { db, ledger, identity };
}

describe('identity.register', () => {
  it('creates an account and writes a GRANT ledger entry', async () => {
    const { identity, ledger } = makeServices();
    const res = await identity.register('alice', 'secret');
    expect(res.playerId).toBeTruthy();
    expect(res.token).toBeTruthy();
    expect(res.balance).toBe(GRANT_AMOUNT);
    expect(ledger.getBalance(res.playerId)).toBe(GRANT_AMOUNT);
    expect(ledger.getEntries(res.playerId)[0].type).toBe('GRANT');
  });

  it('rejects a duplicate username with a clear error', async () => {
    const { identity } = makeServices();
    await identity.register('alice', 'secret');
    await expect(identity.register('alice', 'other')).rejects.toThrow(/already taken/i);
  });

  it('seeds admin role when role=admin is passed', async () => {
    const { identity } = makeServices();
    const res = await identity.register('admin', 'pw', 'admin');
    const payload = identity.verifyToken(res.token);
    expect(payload.role).toBe('admin');
  });
});

describe('identity.login', () => {
  it('returns a valid token for correct credentials', async () => {
    const { identity } = makeServices();
    await identity.register('bob', 'hunter2');
    const { token, playerId } = await identity.login('bob', 'hunter2');
    expect(token).toBeTruthy();
    const payload = identity.verifyToken(token);
    expect(payload.sub).toBe(playerId);
    expect(payload.role).toBe('player');
  });

  it('rejects an unknown username', async () => {
    const { identity } = makeServices();
    await expect(identity.login('nobody', 'pw')).rejects.toThrow(/invalid credentials/i);
  });

  it('rejects a wrong password', async () => {
    const { identity } = makeServices();
    await identity.register('carol', 'right');
    await expect(identity.login('carol', 'wrong')).rejects.toThrow(/invalid credentials/i);
  });
});

describe('identity.clearPassword (soft reset)', () => {
  it('clears the hash, returns the alias, and keeps the same account', async () => {
    const { identity } = makeServices();
    const { playerId } = await identity.register('frank', 'pw');
    const res = identity.clearPassword(playerId);
    expect(res).toEqual({ playerId, username: 'frank' });
    // getUsername still resolves — the account (and its standings) are untouched.
    expect(identity.getUsername(playerId)).toBe('frank');
  });

  it('throws ACCOUNT_NOT_FOUND for an unknown playerId', () => {
    const { identity } = makeServices();
    expect(() => identity.clearPassword('no-such-id')).toThrow(/not found/i);
  });

  it('refuses login on a cleared alias until it is re-claimed', async () => {
    const { identity } = makeServices();
    const { playerId } = await identity.register('grace', 'pw');
    identity.clearPassword(playerId);
    await expect(identity.login('grace', 'pw')).rejects.toThrow(/invalid credentials/i);
  });

  it('re-claim via register reuses the SAME account and does NOT issue a second grant', async () => {
    const { identity, ledger } = makeServices();
    const first = await identity.register('heidi', 'pw');
    // Simulate the soft reset: clear password + the admin wallet grant (null match_id).
    identity.clearPassword(first.playerId);
    ledger.adminCredit(first.playerId, GRANT_AMOUNT, `soft-reset:${first.playerId}`);
    const balanceAfterReset = ledger.getBalance(first.playerId);

    // A returning player re-registers the freed alias with a fresh password.
    const reclaim = await identity.register('heidi', 'new-pw');
    expect(reclaim.playerId).toBe(first.playerId); // same account, standings intact
    // No new GRANT — balance is exactly what the soft reset left.
    expect(ledger.getBalance(first.playerId)).toBe(balanceAfterReset);
    expect(reclaim.balance).toBe(balanceAfterReset);
    // The new password works; the old one does not.
    await expect(identity.login('heidi', 'new-pw')).resolves.toBeTruthy();
    await expect(identity.login('heidi', 'pw')).rejects.toThrow(/invalid credentials/i);
  });

  it('still rejects re-registration of an alias that has NOT been cleared', async () => {
    const { identity } = makeServices();
    await identity.register('ivan', 'pw');
    await expect(identity.register('ivan', 'other')).rejects.toThrow(/already taken/i);
  });
});

describe('identity.verifyToken', () => {
  it('rejects a tampered token', async () => {
    const { identity } = makeServices();
    const { token } = await identity.register('dave', 'pw');
    const tampered = token.slice(0, -3) + 'xxx';
    expect(() => identity.verifyToken(tampered)).toThrow();
  });

  it('rejects an entirely fabricated token', () => {
    const { identity } = makeServices();
    expect(() => identity.verifyToken('not.a.jwt')).toThrow();
  });

  it('returns the correct sub and role from a valid token', async () => {
    const { identity } = makeServices();
    const { token, playerId } = await identity.register('eve', 'pw');
    const payload = identity.verifyToken(token);
    expect(payload.sub).toBe(playerId);
    expect(payload.role).toBe('player');
  });
});

describe('identity.ensureAdmin', () => {
  it('creates the admin account if it does not exist', async () => {
    const { identity, ledger } = makeServices();
    await identity.ensureAdmin('admin', 'admin-dev');
    const { token } = await identity.login('admin', 'admin-dev');
    const payload = identity.verifyToken(token);
    expect(payload.role).toBe('admin');
    expect(ledger.getBalance(payload.sub)).toBe(GRANT_AMOUNT);
  });

  it('is idempotent — calling twice does not throw or double-grant', async () => {
    const { identity, ledger } = makeServices();
    await identity.ensureAdmin('admin', 'admin-dev');
    await expect(identity.ensureAdmin('admin', 'admin-dev')).resolves.not.toThrow();
    const { token } = await identity.login('admin', 'admin-dev');
    const payload = identity.verifyToken(token);
    expect(ledger.getBalance(payload.sub)).toBe(GRANT_AMOUNT);
  });
});
