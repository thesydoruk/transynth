/**
 * An API under test: Fastify with only the route modules a test file names,
 * talking to the database from {@link useTestDb}. Requests go through
 * `app.inject`, so no port is opened.
 *
 * Call after `useTestDb()` in the same describe block: the schema must exist
 * before the routes register, and the default user before the first request.
 */
import { afterAll, beforeAll, beforeEach } from '@jest/globals';
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { ensureDefaultUser } from '../web/auth/authService';
import { registerAuthHook } from '../web/auth/authMiddleware';

type RouteModule = (app: FastifyInstance, db: pg.Pool) => Promise<void>;

export const useTestApp = (
  db: () => pg.Pool,
  ...routes: RouteModule[]
): (() => FastifyInstance) => {
  let app: FastifyInstance | null = null;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerAuthHook(app, db());
    for (const register of routes) await register(app, db());
    await app.ready();
  }, 60_000);

  // Every test starts on empty tables, the built-in user included.
  beforeEach(async () => {
    await ensureDefaultUser(db());
  });

  afterAll(async () => {
    await app?.close();
  });

  return () => {
    if (!app) throw new Error('useTestApp: the app is built in beforeAll');
    return app;
  };
};
