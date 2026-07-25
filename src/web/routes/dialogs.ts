import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import { getDialogTranscript, listDialogGroups, parseDialogScope } from '../data/queries';

/**
 * Read API of the dialogs editor.
 *
 * Two endpoints cover all three scopes (topics, scenes, conversations): one
 * lists the selectable groups with their translation progress, the other loads
 * the transcript of a single group. Editing reuses the strings translation API.
 */
export const dialogsRoutes = async (app: FastifyInstance, db: Tx) => {
  // GET /api/dialogs/groups?modId=&scope=&srcLang=&targetLang=
  app.get<{
    Querystring: { modId?: string; scope?: string; srcLang?: string; targetLang?: string };
  }>('/api/dialogs/groups', async (req, reply) => {
    const modId = Number(req.query.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'modId is required' });
    }
    const scope = parseDialogScope(req.query.scope);
    if (!scope) return reply.code(400).send({ error: 'scope is invalid' });

    const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
    const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;

    return reply.send(await listDialogGroups(db, modId, scope, srcLang, targetLang));
  });

  // GET /api/dialogs/transcript?modId=&scope=&key=&srcLang=&targetLang=
  app.get<{
    Querystring: {
      modId?: string;
      scope?: string;
      key?: string;
      srcLang?: string;
      targetLang?: string;
    };
  }>('/api/dialogs/transcript', async (req, reply) => {
    const modId = Number(req.query.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'modId is required' });
    }
    const scope = parseDialogScope(req.query.scope);
    if (!scope) return reply.code(400).send({ error: 'scope is invalid' });

    const key = req.query.key?.trim();
    if (!key) return reply.code(400).send({ error: 'key is required' });

    const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
    const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;

    const transcript = await getDialogTranscript(db, modId, scope, key, srcLang, targetLang);
    if (!transcript) return reply.code(404).send({ error: 'dialog group not found' });

    return reply.send(transcript);
  });
};
