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
