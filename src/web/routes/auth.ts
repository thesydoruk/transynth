/**
 * Auth API routes — login, logout, current user, and auth mode info.
 *
 * Endpoints:
 * - GET  /api/auth/mode   — returns { multiUser: boolean } (always public)
 * - GET  /api/auth/me     — returns the current user profile
 * - POST /api/auth/login  — authenticates with username/password, sets session cookie
 * - POST /api/auth/logout — clears the session cookie and deletes the session
 */

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { CONFIG } from '../../config.js';
import { authenticateUser, createSession, deleteSession } from '../authService.js';
import { SESSION_COOKIE } from '../authMiddleware.js';
import { logActivity } from '../activityService.js';

/**
 * Registers auth-related routes on the Fastify instance.
 *
 * @param app - Fastify application instance.
 * @param db  - PostgreSQL connection pool.
 */
export const authRoutes = async (app: FastifyInstance, db: pg.Pool): Promise<void> => {

  /**
   * GET /api/auth/mode
   * Returns whether multi-user mode is enabled.
   * Always public — the frontend uses this to decide whether to show login UI.
   */
  app.get('/api/auth/mode', async () => {
    return { multiUser: CONFIG.multiUser };
  });

  /**
   * GET /api/auth/me
   * Returns the current authenticated user's profile.
   * In single-user mode returns the default admin user.
   * In multi-user mode returns 401 if not authenticated (handled by middleware).
   */
  app.get('/api/auth/me', async (req) => {
    return req.user;
  });

  /**
   * POST /api/auth/login
   * Authenticates a user by username and password.
   * On success, creates a session and sets an HTTP-only cookie.
   *
   * Body: { username: string, password: string }
   * Returns: the user profile on success, 401 on failure.
   */
  app.post<{ Body: { username: string; password: string } }>('/api/auth/login', async (req, reply) => {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      reply.code(400).send({ error: 'Username and password are required' });
      return;
    }

    const user = await authenticateUser(db, username, password);
    if (!user) {
      reply.code(401).send({ error: 'Invalid username or password' });
      return;
    }

    const token = await createSession(db, user.id);

    // Set HTTP-only cookie with the session token
    const maxAge = CONFIG.sessionLifetimeHours * 3600;
    reply.header(
      'Set-Cookie',
      `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`,
    );

    await logActivity(db, user.id, 'login', 'user', user.id);
    return user;
  });

  /**
   * POST /api/auth/logout
   * Clears the session cookie and deletes the session from the DB.
   */
  app.post('/api/auth/logout', async (req, reply) => {
    const cookieHeader = req.headers.cookie ?? '';
    const token = extractCookie(cookieHeader, SESSION_COOKIE);

    if (token) {
      if (req.user?.id) {
        await logActivity(db, req.user.id, 'logout', 'user', req.user.id);
      }
      await deleteSession(db, token);
    }

    // Expire the cookie immediately
    reply.header(
      'Set-Cookie',
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
    );

    return { ok: true };
  });
};

/**
 * Extracts a single cookie value from a raw Cookie header string.
 */
const extractCookie = (header: string, name: string): string | undefined => {
  const prefix = `${name}=`;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return undefined;
};
