import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Ledger } from './ledger.js';

export type UserRole = 'player' | 'admin';

export interface TokenPayload {
  sub: string; // playerId
  role: UserRole;
}

/** Resolve a playerId to its display username (undefined if unknown). The single,
 *  shared lookup used for both open-challenge owner names and the leaderboard's
 *  displayName — defined once here, injected where needed. */
export type UsernameLookup = (playerId: string) => string | undefined;

export interface Identity {
  register(
    username: string,
    password: string,
    role?: UserRole,
  ): Promise<{ token: string; playerId: string; balance: number }>;
  login(username: string, password: string): Promise<{ token: string; playerId: string; balance: number }>;
  verifyToken(token: string): TokenPayload;
  /** Display username for a playerId, or undefined if no such account. */
  getUsername: UsernameLookup;
  /** Creates the admin account if it does not already exist. Safe to call on every startup. */
  ensureAdmin(username: string, password: string): Promise<void>;
}

const DEV_JWT_SECRET = 'dev-jwt-secret-change-in-production';
const BCRYPT_ROUNDS = process.env.NODE_ENV === 'test' ? 1 : 10;

interface AccountRow {
  id: string;
  username: string;
  password_hash: string;
  role: string;
}

export function createIdentity(db: Database.Database, ledger: Ledger): Identity {
  const jwtSecret = process.env.JWT_SECRET ?? DEV_JWT_SECRET;
  if (!process.env.JWT_SECRET) {
    console.warn('[identity] JWT_SECRET is not set — using insecure dev default');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id            TEXT PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'player'
    )
  `);

  const stmtInsert = db.prepare<[string, string, string, string]>(
    `INSERT INTO accounts (id, username, password_hash, role) VALUES (?, ?, ?, ?)`,
  );

  const stmtFindByUsername = db.prepare<[string], AccountRow>(
    `SELECT id, username, password_hash, role FROM accounts WHERE username = ?`,
  );

  const stmtFindUsernameById = db.prepare<[string], { username: string }>(
    `SELECT username FROM accounts WHERE id = ?`,
  );

  function signToken(playerId: string, role: UserRole): string {
    return jwt.sign({ sub: playerId, role }, jwtSecret);
  }

  async function register(
    username: string,
    password: string,
    role: UserRole = 'player',
  ): Promise<{ token: string; playerId: string; balance: number }> {
    if (stmtFindByUsername.get(username)) {
      throw Object.assign(new Error(`Username "${username}" is already taken`), { code: 'DUPLICATE_USERNAME' });
    }
    const playerId = randomUUID();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    stmtInsert.run(playerId, username, passwordHash, role);
    ledger.grant(playerId);
    const balance = ledger.getBalance(playerId);
    return { token: signToken(playerId, role), playerId, balance };
  }

  async function login(
    username: string,
    password: string,
  ): Promise<{ token: string; playerId: string; balance: number }> {
    const account = stmtFindByUsername.get(username);
    if (!account) {
      throw Object.assign(new Error('Invalid credentials'), { code: 'INVALID_CREDENTIALS' });
    }
    const valid = await bcrypt.compare(password, account.password_hash);
    if (!valid) {
      throw Object.assign(new Error('Invalid credentials'), { code: 'INVALID_CREDENTIALS' });
    }
    const balance = ledger.getBalance(account.id);
    return { token: signToken(account.id, account.role as UserRole), playerId: account.id, balance };
  }

  function verifyToken(token: string): TokenPayload {
    return jwt.verify(token, jwtSecret) as TokenPayload;
  }

  function getUsername(playerId: string): string | undefined {
    return stmtFindUsernameById.get(playerId)?.username;
  }

  async function ensureAdmin(username: string, password: string): Promise<void> {
    if (!stmtFindByUsername.get(username)) {
      await register(username, password, 'admin');
    }
  }

  return { register, login, verifyToken, getUsername, ensureAdmin };
}
