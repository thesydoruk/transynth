/**
 * Fastify auth middleware — conditionally enforces authentication based
 * on the MULTI_USER config flag.
 *
 * Behaviour:
 * - MULTI_USER=false  → every request is automatically attributed to the
 *   built-in admin user (id=1). No login required.
 * - MULTI_USER=true   → the request must carry a valid session cookie
 *   (`fo4_session`). If missing or invalid, the request is rejected with 401.
 *
 * The middleware decorates every request with `req.user` containing the
 * authenticated user's public profile (UserRow).
 *
 * Routes under `/api/auth/login` and `/api/health` are always public,
 * even in multi-user mode.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type pg from 'pg';
import { CONFIG } from '../config';
import { validateSession, getDefaultUser, type UserRow } from './authService';

/** Name of the HTTP-only cookie that carries the session token. */
export const SESSION_COOKIE = 'fo4_session';

/**
 * Extend Fastify request with the authenticated user.
 * In single-user mode this is always the default admin.
 */
declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow;
  }
}

/** URL prefixes that skip authentication even in multi-user mode. */
const PUBLIC_PREFIXES = ['/api/auth/login', '/api/health'];

/**
 * Registers a `preHandler` hook that populates `req.user`.
 *
 * In single-user mode the hook always injects the default admin user
 * and returns immediately — zero overhead for the typical case.
 *
 * In multi-user mode the hook reads the `fo4_session` cookie, validates
 * it against the sessions table, and rejects the request if the session
 * is invalid or expired.
 */
export const registerAuthHook = async (app: FastifyInstance, db: pg.Pool): Promise<void> => {
  // Pre-fetch the default admin user for single-user mode
  let cachedAdmin: UserRow | undefined;

  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    // ── Single-user mode: inject default admin, skip auth ──────────
    if (!CONFIG.multiUser) {
      if (!cachedAdmin) cachedAdmin = await getDefaultUser(db);
      req.user = cachedAdmin;
      return;
    }

    // ── Multi-user mode ────────────────────────────────────────────
    // Allow public routes without authentication
    if (PUBLIC_PREFIXES.some(p => req.url.startsWith(p))) {
      // Set a stub user for public routes; actual login handler will override
      req.user = undefined as unknown as UserRow;
      return;
    }

    // Static file requests (SPA) — no auth required
    if (!req.url.startsWith('/api/')) {
      req.user = undefined as unknown as UserRow;
      return;
    }

    // The /api/auth/me endpoint must be accessible to check auth status
    // but should return 401 if not authenticated (handled below)

    // Read session token from cookie
    const cookieHeader = req.headers.cookie ?? '';
    const token = parseCookie(cookieHeader, SESSION_COOKIE);

    if (!token) {
      reply.code(401).send({ error: 'Authentication required' });
      return;
    }

    const user = await validateSession(db, token);
    if (!user) {
      reply.code(401).send({ error: 'Session expired or invalid' });
      return;
    }

    req.user = user;
  });
};

/**
 * Parses a single cookie value from a raw Cookie header string.
 * Avoids pulling in a full cookie-parsing dependency.
 */
const parseCookie = (header: string, name: string): string | undefined => {
  const prefix = `${name}=`;
  const parts = header.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length);
    }
  }
  return undefined;
};
