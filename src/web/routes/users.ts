/**
 * User management API routes — CRUD for users.
 * Only accessible to admin users in multi-user mode.
 * In single-user mode these endpoints are still registered but return 403
 * for any mutating operation.
 *
 * Endpoints:
 * - GET    /api/users           — list all users
 * - POST   /api/users           — create a new user (admin only)
 * - PATCH  /api/users/:id       — update user profile (admin only)
 * - POST   /api/users/:id/password — change user password (admin or self)
 */

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { CONFIG } from '../../config.js';
import { listUsers, createUser, updateUser, changePassword, type UserRole } from '../authService.js';
import { logActivity } from '../activityService.js';

/** Valid roles for validation. */
const VALID_ROLES: UserRole[] = ['admin', 'translator', 'reviewer'];

/**
 * Registers user management routes on the Fastify instance.
 *
 * @param app - Fastify application instance.
 * @param db  - PostgreSQL connection pool.
 */
export const usersRoutes = async (app: FastifyInstance, db: pg.Pool): Promise<void> => {

  /**
   * GET /api/users
   * Returns all users (without password hashes).
   * Available to any authenticated user (to populate assignment UIs, etc.)
   */
  app.get('/api/users', async () => {
    return listUsers(db);
  });

  /**
   * POST /api/users
   * Creates a new user. Requires admin role in multi-user mode.
   *
   * Body: { username, display_name, password, role }
   */
  app.post<{ Body: { username: string; display_name: string; password: string; role: UserRole } }>(
    '/api/users',
    async (req, reply) => {
      if (!CONFIG.multiUser) {
        reply.code(403).send({ error: 'User management is disabled in single-user mode' });
        return;
      }
      if (req.user.role !== 'admin') {
        reply.code(403).send({ error: 'Only admins can create users' });
        return;
      }

      const { username, display_name, password, role } = req.body ?? {};
      if (!username || !display_name || !password || !role) {
        reply.code(400).send({ error: 'All fields are required: username, display_name, password, role' });
        return;
      }
      if (!VALID_ROLES.includes(role)) {
        reply.code(400).send({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
        return;
      }

      try {
        const user = await createUser(db, username, display_name, password, role);
        await logActivity(db, req.user.id, 'create_user', 'user', user.id, { username, role });
        reply.code(201).send(user);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('unique') || msg.includes('duplicate')) {
          reply.code(409).send({ error: `Username "${username}" is already taken` });
          return;
        }
        throw err;
      }
    },
  );

  /**
   * PATCH /api/users/:id
   * Updates a user's display name, role, or active status.
   * Only admins can change roles or deactivate users.
   *
   * Body: { display_name?, role?, is_active? }
   */
  app.patch<{ Params: { id: string }; Body: { display_name?: string; role?: UserRole; is_active?: boolean } }>(
    '/api/users/:id',
    async (req, reply) => {
      if (!CONFIG.multiUser) {
        reply.code(403).send({ error: 'User management is disabled in single-user mode' });
        return;
      }
      if (req.user.role !== 'admin') {
        reply.code(403).send({ error: 'Only admins can update users' });
        return;
      }

      const userId = parseInt(req.params.id, 10);
      if (isNaN(userId)) {
        reply.code(400).send({ error: 'Invalid user ID' });
        return;
      }

      const { role } = req.body;
      if (role && !VALID_ROLES.includes(role)) {
        reply.code(400).send({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
        return;
      }

      const updated = await updateUser(db, userId, req.body);
      if (!updated) {
        reply.code(404).send({ error: 'User not found' });
        return;
      }

      await logActivity(db, req.user.id, 'update_user', 'user', userId, req.body as Record<string, unknown>);
      return updated;
    },
  );

  /**
   * POST /api/users/:id/password
   * Changes a user's password. Admins can change any password.
   * Non-admins can only change their own password (must provide current_password).
   *
   * Body: { new_password, current_password? }
   */
  app.post<{ Params: { id: string }; Body: { new_password: string; current_password?: string } }>(
    '/api/users/:id/password',
    async (req, reply) => {
      if (!CONFIG.multiUser) {
        reply.code(403).send({ error: 'Password management is disabled in single-user mode' });
        return;
      }

      const userId = parseInt(req.params.id, 10);
      if (isNaN(userId)) {
        reply.code(400).send({ error: 'Invalid user ID' });
        return;
      }

      const { new_password } = req.body ?? {};
      if (!new_password || new_password.length < 4) {
        reply.code(400).send({ error: 'Password must be at least 4 characters' });
        return;
      }

      // Non-admins can only change their own password
      if (req.user.role !== 'admin' && req.user.id !== userId) {
        reply.code(403).send({ error: 'You can only change your own password' });
        return;
      }

      await changePassword(db, userId, new_password);
      await logActivity(db, req.user.id, 'change_password', 'user', userId);
      return { ok: true };
    },
  );
};
