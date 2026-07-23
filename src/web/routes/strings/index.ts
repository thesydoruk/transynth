import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../../db';
import { registerListRoutes } from './listRoutes';
import { registerTranslationRoutes } from './translationRoutes';
import { registerBatchRoutes } from './batchRoutes';

export const stringsRoutes = async (app: FastifyInstance, db: Tx) => {
  await registerListRoutes(app, db);
  await registerTranslationRoutes(app, db);
  await registerBatchRoutes(app, db);
};
