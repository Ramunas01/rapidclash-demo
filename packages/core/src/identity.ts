import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { AvatarId } from '@rapidclash/shared';
import { AVATAR_IDS } from '@rapidclash/shared';
import type { Ledger } from './ledger.js';

export type UserRole = 'player' | 'admin';

/** True iff `v` is one of the canonical AvatarId enum values (server-side validation). */
export function isAvatarId(v: unknown): v is AvatarId {
  return typeof v === 'string' && (AVATAR_IDS as readonly string[]).includes(v);
}

export interface TokenPayload {
  sub: string; // playerId
  role: UserRole;
}

/** Resolve a playerId to its display username (undefined if unknown). The single,
 *  shared lookup used for both open-challenge owner names and the leaderboard's
 *  displayName — defined once here, injected where needed. */
export type UsernameLookup = (playerId: string) => string | undefined;

/** Resolve a playerId to its stored avatarId — the leaderboard's per-entry avatar seam, a sibling
 *  to {@link UsernameLookup}. Defaults to `'default'` for an unknown/unset account. */
export type AvatarLookup = (playerId: string) => AvatarId;

export interface Identity {
  register(
    username: string,
    password: string,
    role?: UserRole,
  ): Promise<{ token: string; playerId: string; balance: number; avatarId: AvatarId }>;
  login(
    username: string,
    password: string,
  ): Promise<{ token: string; playerId: string; balance: number; avatarId: AvatarId }>;
  verifyToken(token: string): TokenPayload;
  /** Display username for a playerId, or undefined if no such account. */
  getUsername: UsernameLookup;
  /** Stored avatarId for a playerId (`'default'` if unknown/unset). Sibling to {@link getUsername};
   *  the leaderboard resolves each entry's avatar through it. */
  getAvatarId: AvatarLookup;
  /** Persist a player's own avatar (presets-only; validate before calling). Idempotent. */
  setAvatarId(playerId: string, avatarId: AvatarId): void;
  /** Clear an account's password hash (sets it to NULL) so the alias becomes
   *  re-claimable via {@link register} while the account, its match history, and
   *  standings stay intact. Throws ACCOUNT_NOT_FOUND if no such playerId. The
   *  soft-reset primitive (ADR-011); does not touch the wallet — the caller issues
   *  the fresh grant. */
  clearPassword(playerId: string): { playerId: string; username: string };
  /** Creates the admin account if it does not already exist. Safe to call on every startup. */
  ensureAdmin(username: string, password: string): Promise<void>;
}

const DEV_JWT_SECRET = 'dev-jwt-secret-change-in-production';
const BCRYPT_ROUNDS = process.env.NODE_ENV === 'test' ? 1 : 10;

interface AccountRow {
  id: string;
  username: string;
  // NULL after a soft reset (ADR-011): the alias exists but is unauthenticated and
  // re-claimable. A new register() sets a fresh hash; login() is refused meanwhile.
  password_hash: string | null;
  role: string;
  avatar_id: string;
}

export function createIdentity(db: Database.Database, ledger: Ledger): Identity {
  const jwtSecret = process.env.JWT_SECRET ?? DEV_JWT_SECRET;
  if (!process.env.JWT_SECRET) {
    console.warn('[identity] JWT_SECRET is not set — using insecure dev default');
  }

  // password_hash is nullable: a soft reset (ADR-011) clears it to NULL to free the
  // alias for re-claim without deleting the account or its standings.
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id            TEXT PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      role          TEXT NOT NULL DEFAULT 'player'
    )
  `);

  // Snapshot-safe, idempotent migration (ADR-011): a restored OLD snapshot predates the
  // avatar_id column, so add it if absent. Guarded by a PRAGMA check so a fresh DB (column
  // already created above? no — the CREATE omits it) and an already-migrated DB both no-op.
  // Existing rows inherit DEFAULT 'default'. Running init twice is safe.
  const hasAvatarColumn = db
    .prepare<[], { name: string }>(`PRAGMA table_info(accounts)`)
    .all()
    .some((c) => c.name === 'avatar_id');
  if (!hasAvatarColumn) {
    db.exec(`ALTER TABLE accounts ADD COLUMN avatar_id TEXT NOT NULL DEFAULT 'default'`);
  }

  const stmtInsert = db.prepare<[string, string, string, string]>(
    `INSERT INTO accounts (id, username, password_hash, role) VALUES (?, ?, ?, ?)`,
  );

  const stmtFindByUsername = db.prepare<[string], AccountRow>(
    `SELECT id, username, password_hash, role, avatar_id FROM accounts WHERE username = ?`,
  );

  const stmtFindUsernameById = db.prepare<[string], { username: string }>(
    `SELECT username FROM accounts WHERE id = ?`,
  );

  const stmtFindAvatarById = db.prepare<[string], { avatar_id: string }>(
    `SELECT avatar_id FROM accounts WHERE id = ?`,
  );

  const stmtSetAvatar = db.prepare<[string, string]>(
    `UPDATE accounts SET avatar_id = ? WHERE id = ?`,
  );

  const stmtSetPassword = db.prepare<[string, string]>(
    `UPDATE accounts SET password_hash = ? WHERE id = ?`,
  );

  const stmtClearPassword = db.prepare<[string]>(
    `UPDATE accounts SET password_hash = NULL WHERE id = ?`,
  );

  function signToken(playerId: string, role: UserRole): string {
    return jwt.sign({ sub: playerId, role }, jwtSecret);
  }

  /** Coerce a stored avatar_id string to a valid AvatarId, defaulting to `'default'` for anything
   *  unrecognised (defensive — a restored/legacy row could in theory carry an unknown value). */
  function coerceAvatar(v: string | undefined): AvatarId {
    return isAvatarId(v) ? v : 'default';
  }

  async function register(
    username: string,
    password: string,
    role: UserRole = 'player',
  ): Promise<{ token: string; playerId: string; balance: number; avatarId: AvatarId }> {
    const existing = stmtFindByUsername.get(username);
    if (existing) {
      // Alias is taken AND still has a password → genuine collision.
      if (existing.password_hash !== null) {
        throw Object.assign(new Error(`Username "${username}" is already taken`), { code: 'DUPLICATE_USERNAME' });
      }
      // Alias was soft-reset (ADR-011): re-claim it. Set a fresh password on the SAME
      // account so its match history, standings, and (already-reset) wallet carry over.
      // No grant — the soft reset already issued the starting credit; granting again
      // here would double it. The original role AND stored avatar are preserved.
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      stmtSetPassword.run(passwordHash, existing.id);
      const balance = ledger.getBalance(existing.id);
      return {
        token: signToken(existing.id, existing.role as UserRole),
        playerId: existing.id,
        balance,
        avatarId: coerceAvatar(existing.avatar_id),
      };
    }
    const playerId = randomUUID();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    // avatar_id defaults to 'default' via the column DEFAULT — a new registrant starts there.
    stmtInsert.run(playerId, username, passwordHash, role);
    ledger.grant(playerId);
    const balance = ledger.getBalance(playerId);
    return { token: signToken(playerId, role), playerId, balance, avatarId: 'default' };
  }

  async function login(
    username: string,
    password: string,
  ): Promise<{ token: string; playerId: string; balance: number; avatarId: AvatarId }> {
    const account = stmtFindByUsername.get(username);
    if (!account || account.password_hash === null) {
      // No such account, or the alias was soft-reset and not yet re-claimed — either
      // way it cannot authenticate. Same opaque error so neither case is enumerable.
      throw Object.assign(new Error('Invalid credentials'), { code: 'INVALID_CREDENTIALS' });
    }
    const valid = await bcrypt.compare(password, account.password_hash);
    if (!valid) {
      throw Object.assign(new Error('Invalid credentials'), { code: 'INVALID_CREDENTIALS' });
    }
    const balance = ledger.getBalance(account.id);
    return {
      token: signToken(account.id, account.role as UserRole),
      playerId: account.id,
      balance,
      avatarId: coerceAvatar(account.avatar_id),
    };
  }

  function verifyToken(token: string): TokenPayload {
    return jwt.verify(token, jwtSecret) as TokenPayload;
  }

  function getUsername(playerId: string): string | undefined {
    return stmtFindUsernameById.get(playerId)?.username;
  }

  function getAvatarId(playerId: string): AvatarId {
    return coerceAvatar(stmtFindAvatarById.get(playerId)?.avatar_id);
  }

  function setAvatarId(playerId: string, avatarId: AvatarId): void {
    stmtSetAvatar.run(avatarId, playerId);
  }

  function clearPassword(playerId: string): { playerId: string; username: string } {
    const row = stmtFindUsernameById.get(playerId);
    if (!row) {
      throw Object.assign(new Error('Account not found'), { code: 'ACCOUNT_NOT_FOUND' });
    }
    stmtClearPassword.run(playerId);
    return { playerId, username: row.username };
  }

  async function ensureAdmin(username: string, password: string): Promise<void> {
    if (!stmtFindByUsername.get(username)) {
      await register(username, password, 'admin');
    }
  }

  return { register, login, verifyToken, getUsername, getAvatarId, setAvatarId, clearPassword, ensureAdmin };
}
