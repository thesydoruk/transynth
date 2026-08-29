/**
 * Request user middleware — attributes every API request to the built-in default user.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { getDefaultUser, type DefaultUser } from './authService';

declare module 'fastify' {
  interface FastifyRequest {
    user: DefaultUser;
  }
}

/** Registers a preHandler hook that populates `req.user` with the default user. */
export const registerAuthHook = async (app: FastifyInstance, db: pg.Pool): Promise<void> => {
  let cachedUser: DefaultUser | undefined;

  app.addHook('preHandler', async (req: FastifyRequest) => {
    if (!cachedUser) cachedUser = await getDefaultUser(db);
    req.user = cachedUser;
  });
};
