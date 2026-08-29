import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../../db';
import { registerListCrudRoutes } from './listCrud';
import { registerVoiceRoutes } from './voice';
import { registerVoiceRegenerateRoutes } from './voiceRegenerate';
import { registerExportRoutes } from './export';
import { registerApplyImportedRoutes } from './applyImported';
import { registerDiffCarryOverRoutes } from './diffCarryOver';

export const modsRoutes = async (app: FastifyInstance, db: Tx) => {
  await registerListCrudRoutes(app, db);
  await registerVoiceRoutes(app, db);
  await registerVoiceRegenerateRoutes(app, db);
  await registerExportRoutes(app, db);
  await registerApplyImportedRoutes(app, db);
  await registerDiffCarryOverRoutes(app, db);
};
