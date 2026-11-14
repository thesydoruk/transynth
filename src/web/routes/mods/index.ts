import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../../db';
import { ensureVortexSchema } from '../../../vortex/schema';
import { registerListCrudRoutes } from './listCrud';
import { registerContentKindRoutes } from './contentKind';
import { registerModVideoRoutes } from './video';
import { registerModVideoJobRoutes } from './videoJobs';
import { registerVoiceRoutes } from './voice';
import { registerVoiceRegenerateRoutes } from './voiceRegenerate';
import { registerExportRoutes } from './export';
import { registerApplyImportedRoutes } from './applyImported';
import { registerDiffCarryOverRoutes } from './diffCarryOver';

export const modsRoutes = async (app: FastifyInstance, db: Tx) => {
  await ensureVortexSchema(db);
  await registerListCrudRoutes(app, db);
  await registerContentKindRoutes(app, db);
  await registerVoiceRoutes(app, db);
  await registerModVideoRoutes(app, db);
  await registerModVideoJobRoutes(app, db);
  await registerVoiceRegenerateRoutes(app, db);
  await registerExportRoutes(app, db);
  await registerApplyImportedRoutes(app, db);
  await registerDiffCarryOverRoutes(app, db);
};
