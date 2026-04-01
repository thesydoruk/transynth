import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db.js';
import { CONFIG } from '../../config.js';
import { listDialogTopics, getDialogTree } from '../queries.js';

/**
 * Dialog tree routes used by the dedicated "Dialogs mode" UI.
 */
export const dialogsRoutes = async (app: FastifyInstance, db: Tx) => {
  // GET /api/dialogs/topics?modId=
  app.get<{ Querystring: { modId?: string } }>('/api/dialogs/topics', async (req, reply) => {
    const modId = Number(req.query.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'modId is required' });
    }
    return reply.send(await listDialogTopics(db, modId));
  });

  // GET /api/dialogs/tree?topicId=&srcLang=&targetLang=
  app.get<{
    Querystring: { topicId?: string; srcLang?: string; targetLang?: string };
  }>('/api/dialogs/tree', async (req, reply) => {
    const topicId = Number(req.query.topicId);
    if (!Number.isInteger(topicId) || topicId < 1) {
      return reply.code(400).send({ error: 'topicId is required' });
    }

    const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
    const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;

    return reply.send(await getDialogTree(db, topicId, srcLang, targetLang));
  });
};
