/**
 * Authentication service — handles password hashing, session management,
 * and user CRUD operations.
 *
 * Uses Node.js built-in `crypto.scrypt` for password hashing (no external deps).
 * Sessions are stored in the database with random 64-byte hex tokens.
 *
 * In single-user mode (MULTI_USER=false) the auth layer is bypassed entirely
 * and every request is attributed to the built-in admin user (id=1).
 */

import crypto from 'crypto';
import type pg from 'pg';
import { CONFIG } from '../config';
import { logAuth } from '../logging/loggers';

/** Roles supported by the system, ordered by privilege level. */
export type UserRole = 'admin' | 'reviewer' | 'translator';

/** Public-safe user representation (no password_hash). */
export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Session row from the DB. */
export interface SessionRow {
  id: number;
  user_id: number;
  token: string;
  expires_at: string;
}

// ── Password hashing ─────────────────────────────────────────────────────────

const SCRYPT_KEY_LEN = 64;
const SALT_LEN = 32;

/**
 * Hashes a plaintext password using scrypt with a random salt.
 * Returns a string in the format `salt:derivedKey` (both hex-encoded).
 */
export const hashPassword = (password: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(SALT_LEN).toString('hex');
    crypto.scrypt(password, salt, SCRYPT_KEY_LEN, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });

/**
 * Verifies a plaintext password against a stored hash (salt:derivedKey).
 * Uses timing-safe comparison to prevent timing attacks.
 */
export const verifyPassword = (password: string, storedHash: string): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const [salt, key] = storedHash.split(':');
    if (!salt || !key) return resolve(false);
    crypto.scrypt(password, salt, SCRYPT_KEY_LEN, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(crypto.timingSafeEqual(Buffer.from(key, 'hex'), derivedKey));
    });
  });

// ── Session management ───────────────────────────────────────────────────────

/**
 * Creates a new session for the given user.
 * Generates a cryptographically random 64-byte token and stores it in the DB
 * with an expiration timestamp based on SESSION_LIFETIME_HOURS config.
 *
 * @returns The session token string (to be set as a cookie).
 */
export const createSession = async (db: pg.Pool, userId: number): Promise<string> => {
  const token = crypto.randomBytes(64).toString('hex');
  const expiresAt = new Date(Date.now() + CONFIG.sessionLifetimeHours * 3600_000);
  await db.query('INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)', [
    userId,
    token,
    expiresAt.toISOString(),
  ]);
  logAuth.info(`Session created for user ${userId}`);
  return token;
};

/**
 * Validates a session token and returns the associated user if the session
 * is still active (not expired). Returns undefined for invalid/expired tokens.
 */
export const validateSession = async (db: pg.Pool, token: string): Promise<UserRow | undefined> => {
  const { rows } = await db.query<UserRow & { expires_at: string }>(
    `SELECT u.id, u.username, u.display_name, u.role, u.is_active,
            u.created_at, u.updated_at, s.expires_at
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.token = $1`,
    [token],
  );
  if (rows.length === 0) return undefined;
  const row = rows[0];
  // Check expiry
  if (new Date(row.expires_at) < new Date()) {
    await db.query('DELETE FROM sessions WHERE token = $1', [token]);
    return undefined;
  }
  // Check if the user is still active
  if (!row.is_active) return undefined;
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role as UserRole,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

/**
 * Deletes a session by its token (logout).
 */
export const deleteSession = async (db: pg.Pool, token: string): Promise<void> => {
  await db.query('DELETE FROM sessions WHERE token = $1', [token]);
};

/**
 * Removes all expired sessions from the database (housekeeping).
 */
export const cleanExpiredSessions = async (db: pg.Pool): Promise<number> => {
  const { rowCount } = await db.query('DELETE FROM sessions WHERE expires_at < NOW()');
  return rowCount ?? 0;
};

// ── User CRUD ────────────────────────────────────────────────────────────────

/**
 * Returns the built-in default admin user (id=1).
 * Used in single-user mode to attribute all actions.
 */
export const getDefaultUser = async (db: pg.Pool): Promise<UserRow> => {
  const { rows } = await db.query<UserRow>(
    'SELECT id, username, display_name, role, is_active, created_at, updated_at FROM users WHERE id = 1',
  );
  return rows[0];
};

/**
 * Ensures the default admin user exists with a valid password hash.
 * Called at server startup. If the password_hash is the placeholder
 * from schema.sql, it gets replaced with a real hash of "admin".
 */
export const ensureDefaultAdmin = async (db: pg.Pool): Promise<void> => {
  const { rows } = await db.query('SELECT id, password_hash FROM users WHERE id = 1');
  if (rows.length === 0) {
    const hash = await hashPassword('admin');
    await db.query(
      `INSERT INTO users (id, username, display_name, password_hash, role)
       VALUES (1, 'admin', 'Administrator', $1, 'admin')`,
      [hash],
    );
    logAuth.info('Default admin user created');
  } else if (rows[0].password_hash === '__PLACEHOLDER__') {
    const hash = await hashPassword('admin');
    await db.query('UPDATE users SET password_hash = $1 WHERE id = 1', [hash]);
    logAuth.info('Default admin password hash initialized');
  }
};

/**
 * Authenticates a user by username and password.
 * Returns the user row on success, undefined on failure.
 */
export const authenticateUser = async (
  db: pg.Pool,
  username: string,
  password: string,
): Promise<UserRow | undefined> => {
  const { rows } = await db.query(
    'SELECT id, username, display_name, role, is_active, created_at, updated_at, password_hash FROM users WHERE username = $1',
    [username],
  );
  if (rows.length === 0) return undefined;
  const row = rows[0];
  if (!row.is_active) return undefined;
  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) return undefined;
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role as UserRole,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

/**
 * Lists all users (without password hashes).
 */
export const listUsers = async (db: pg.Pool): Promise<UserRow[]> => {
  const { rows } = await db.query<UserRow>(
    'SELECT id, username, display_name, role, is_active, created_at, updated_at FROM users ORDER BY id',
  );
  return rows;
};

/**
 * Creates a new user with the given credentials and role.
 * Password is hashed before storage.
 *
 * @returns The newly created user row.
 */
export const createUser = async (
  db: pg.Pool,
  username: string,
  displayName: string,
  password: string,
  role: UserRole,
): Promise<UserRow> => {
  const hash = await hashPassword(password);
  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (username, display_name, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username, display_name, role, is_active, created_at, updated_at`,
    [username, displayName, hash, role],
  );
  logAuth.info(`User created: ${username} (role: ${role})`);
  return rows[0];
};

/**
 * Updates a user's profile (display name, role, active status).
 * Does NOT change the password — use changePassword() for that.
 */
export const updateUser = async (
  db: pg.Pool,
  userId: number,
  updates: { display_name?: string; role?: UserRole; is_active?: boolean },
): Promise<UserRow | undefined> => {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;
  if (updates.display_name !== undefined) {
    sets.push(`display_name = $${idx++}`);
    vals.push(updates.display_name);
  }
  if (updates.role !== undefined) {
    sets.push(`role = $${idx++}`);
    vals.push(updates.role);
  }
  if (updates.is_active !== undefined) {
    sets.push(`is_active = $${idx++}`);
    vals.push(updates.is_active);
  }
  if (sets.length === 0) return undefined;
  sets.push(`updated_at = NOW()`);
  vals.push(userId);
  const { rows } = await db.query<UserRow>(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx}
     RETURNING id, username, display_name, role, is_active, created_at, updated_at`,
    vals,
  );
  return rows[0];
};

/**
 * Changes a user's password. The new password is hashed before storage.
 * All existing sessions for this user are invalidated.
 */
export const changePassword = async (
  db: pg.Pool,
  userId: number,
  newPassword: string,
): Promise<void> => {
  const hash = await hashPassword(newPassword);
  await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
    hash,
    userId,
  ]);
  // Invalidate all sessions for this user
  await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  logAuth.info(`Password changed for user ${userId}, all sessions invalidated`);
};
