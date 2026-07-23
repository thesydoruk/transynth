import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../../db';
import { registerCatalogueRoutes } from './catalogue';
import { registerNexusSearchRoutes } from './nexusSearch';
import { registerNexusModRoutes } from './nexusMod';
import { registerNexusFileRoutes } from './nexusFiles';
import { registerNexusRelationsRoutes } from './nexusRelations';
import { registerNexusTranslationsRoutes } from './nexusTranslations';

export { type GameInfo, SUPPORTED_GAMES } from './catalogue';

export const gamesRoutes = async (app: FastifyInstance, db: Tx) => {
  await registerCatalogueRoutes(app);
  await registerNexusSearchRoutes(app);
  await registerNexusModRoutes(app);
  await registerNexusFileRoutes(app, db);
  await registerNexusRelationsRoutes(app);
  await registerNexusTranslationsRoutes(app);
};
