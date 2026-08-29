import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../../db';
import {
  listStrings,
  listMatchingStringIds,
  listSignatures,
  getRagSuggestions,
  getTranslationHistory,
  getQAIssues,
} from '../../data/queries';
import { CONFIG } from '../../../config';

export const registerListRoutes = async (app: FastifyInstance, db: Tx) => {
  // GET /api/strings?modId=&srcLang=&targetLang=&status=&signature=&q=&grup=&formid=&edid=&field=&page=&pageSize=
  app.get<{
    Querystring: {
      modId?: string;
      srcLang?: string;
      targetLang?: string;
      status?: string;
      qaOnly?: string;
      signature?: string;
      q?: string;
      grup?: string;
      formid?: string;
      edid?: string;
      field?: string;
      src?: string;
      transl?: string;
      hideIgnored?: string;
      page?: string;
      pageSize?: string;
      sort?: string;
      order?: string;
    };
  }>('/api/strings', async (req, reply) => {
    const modId = Number(req.query.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'modId is required' });
    }

    const result = await listStrings(db, {
      modId,
      srcLang: req.query.srcLang,
      targetLang: req.query.targetLang,
      status: req.query.status,
      qaOnly: req.query.qaOnly === '1' || req.query.qaOnly === 'true',
      query: req.query.q,
      signature: req.query.signature,
      grup: req.query.grup,
      formid: req.query.formid,
      edid: req.query.edid,
      field: req.query.field,
      src: req.query.src,
      transl: req.query.transl,
      hideIgnored: req.query.hideIgnored === '1' || req.query.hideIgnored === 'true',
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
      sort: req.query.sort,
      order: req.query.order === 'desc' ? 'desc' : req.query.order === 'asc' ? 'asc' : undefined,
    });

    return reply.send(result);
  });

  // GET /api/strings/ids?modId=&...filters — all string IDs matching a filter.
  //
  // Powers the editor's "select all matching" feature for client-side bulk
  // actions (e.g. batch translate) that still need an explicit ID list.
  app.get<{
    Querystring: {
      modId?: string;
      srcLang?: string;
      targetLang?: string;
      status?: string;
      qaOnly?: string;
      signature?: string;
      q?: string;
      grup?: string;
      formid?: string;
      edid?: string;
      field?: string;
      src?: string;
      transl?: string;
      hideIgnored?: string;
    };
  }>('/api/strings/ids', async (req, reply) => {
    const modId = Number(req.query.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'modId is required' });
    }

    const ids = await listMatchingStringIds(db, {
      modId,
      srcLang: req.query.srcLang,
      targetLang: req.query.targetLang,
      status: req.query.status,
      qaOnly: req.query.qaOnly === '1' || req.query.qaOnly === 'true',
      query: req.query.q,
      signature: req.query.signature,
      grup: req.query.grup,
      formid: req.query.formid,
      edid: req.query.edid,
      field: req.query.field,
      src: req.query.src,
      transl: req.query.transl,
      hideIgnored: req.query.hideIgnored === '1' || req.query.hideIgnored === 'true',
    });
    return reply.send({ ids });
  });

  // GET /api/strings/signatures?modId=&srcLang=&targetLang=&status=&…
  app.get<{
    Querystring: {
      modId?: string;
      srcLang?: string;
      targetLang?: string;
      status?: string;
      qaOnly?: string;
      q?: string;
      grup?: string;
      formid?: string;
      edid?: string;
      field?: string;
      src?: string;
      transl?: string;
      hideIgnored?: string;
    };
  }>('/api/strings/signatures', async (req, reply) => {
    const modId = Number(req.query.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'modId is required' });
    }
    return reply.send(
      await listSignatures(db, {
        modId,
        srcLang: req.query.srcLang,
        targetLang: req.query.targetLang,
        status: req.query.status,
        qaOnly: req.query.qaOnly === '1' || req.query.qaOnly === 'true',
        query: req.query.q,
        grup: req.query.grup,
        formid: req.query.formid,
        edid: req.query.edid,
        field: req.query.field,
        src: req.query.src,
        transl: req.query.transl,
        hideIgnored: req.query.hideIgnored === '1' || req.query.hideIgnored === 'true',
      }),
    );
  });

  // GET /api/strings/:stringId/suggestions?targetLang=
  app.get<{ Params: { stringId: string }; Querystring: { targetLang?: string } }>(
    '/api/strings/:stringId/suggestions',
    async (req, reply) => {
      const stringId = Number(req.params.stringId);
      if (!Number.isInteger(stringId) || stringId < 1) {
        return reply.code(400).send({ error: 'Invalid string id' });
      }
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      const suggestions = await getRagSuggestions(db, stringId, targetLang);
      return reply.send(suggestions);
    },
  );

  // GET /api/strings/:stringId/history?targetLang=
  app.get<{ Params: { stringId: string }; Querystring: { targetLang?: string } }>(
    '/api/strings/:stringId/history',
    async (req, reply) => {
      const stringId = Number(req.params.stringId);
      if (!Number.isInteger(stringId) || stringId < 1) {
        return reply.code(400).send({ error: 'Invalid string id' });
      }
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      return reply.send(await getTranslationHistory(db, stringId, targetLang));
    },
  );

  // GET /api/strings/:stringId/qa?targetLang=
  app.get<{ Params: { stringId: string }; Querystring: { targetLang?: string } }>(
    '/api/strings/:stringId/qa',
    async (req, reply) => {
      const stringId = Number(req.params.stringId);
      if (!Number.isInteger(stringId) || stringId < 1) {
        return reply.code(400).send({ error: 'Invalid string id' });
      }
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      return reply.send(await getQAIssues(db, stringId, targetLang));
    },
  );
};
