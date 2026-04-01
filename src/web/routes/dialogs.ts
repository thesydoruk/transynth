import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import {
  listDialogTopics,
  getDialogTree,
  listDialogScenes,
  getSceneDialog,
  listDialogConversations,
  getConversationDialog,
} from '../queries';

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

  // GET /api/dialogs/scenes?modId=
  app.get<{ Querystring: { modId?: string } }>('/api/dialogs/scenes', async (req, reply) => {
    const modId = Number(req.query.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'modId is required' });
    }
    return reply.send(await listDialogScenes(db, modId));
  });

  // GET /api/dialogs/conversations?modId=
  app.get<{ Querystring: { modId?: string } }>('/api/dialogs/conversations', async (req, reply) => {
    const modId = Number(req.query.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'modId is required' });
    }
    return reply.send(await listDialogConversations(db, modId));
  });

  // GET /api/dialogs/scene?sceneId=&srcLang=&targetLang=
  app.get<{
    Querystring: { sceneId?: string; srcLang?: string; targetLang?: string };
  }>('/api/dialogs/scene', async (req, reply) => {
    const sceneId = Number(req.query.sceneId);
    if (!Number.isInteger(sceneId) || sceneId < 1) {
      return reply.code(400).send({ error: 'sceneId is required' });
    }

    const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
    const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;

    return reply.send(await getSceneDialog(db, sceneId, srcLang, targetLang));
  });

  // GET /api/dialogs/conversation?modId=&key=&srcLang=&targetLang=
  app.get<{
    Querystring: { modId?: string; key?: string; srcLang?: string; targetLang?: string };
  }>('/api/dialogs/conversation', async (req, reply) => {
    const modId = Number(req.query.modId);
    const key = req.query.key?.trim();
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'modId is required' });
    }
    if (!key) {
      return reply.code(400).send({ error: 'key is required' });
    }

    const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
    const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;

    return reply.send(await getConversationDialog(db, modId, key, srcLang, targetLang));
  });
};
