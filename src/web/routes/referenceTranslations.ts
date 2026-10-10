/**
 * Reference translations API: the per-game, mod-independent base that TM
 * auto-apply reads ahead of live mods.
 */
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import { log } from '../../logger';
import {
  addManualReferenceTranslation,
  countReferenceTranslations,
  deleteReferenceTranslations,
  listReferenceTranslations,
  promoteTranslationsToReference,
  REFERENCE_PROMOTE_STATUSES,
  updateReferenceTranslation,
} from '../data/queries/referenceTranslations';
import { isValidTranslationStatus } from '../data/statusMachine';
import { parseRouteId } from './parseRouteId';

const parseIdList = (raw: unknown): number[] | null => {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (!raw.every((id) => Number.isInteger(id) && id > 0)) return null;
  return [...new Set(raw as number[])];
};

export const referenceTranslationRoutes = async (app: FastifyInstance, db: Tx) => {
  // GET /api/reference?game=&srcLang=&tgtLang=&q=&limit=&offset=
  app.get<{
    Querystring: {
      game?: string;
      srcLang?: string;
      tgtLang?: string;
      q?: string;
      limit?: string;
      offset?: string;
    };
  }>('/api/reference', async (req, reply) => {
    const { game, srcLang, tgtLang, q, limit, offset } = req.query;
    const result = await listReferenceTranslations(db, {
      game,
      srcLang,
      tgtLang,
      q,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return reply.send(result);
  });

  // GET /api/reference/count?game=&srcLang=&tgtLang=
  app.get<{ Querystring: { game?: string; srcLang?: string; tgtLang?: string } }>(
    '/api/reference/count',
    async (req, reply) => {
      const { game, srcLang, tgtLang } = req.query;
      const count = await countReferenceTranslations(
        db,
        game,
        srcLang || CONFIG.defaultSrcLang,
        tgtLang || CONFIG.defaultTgtLang,
      );
      return reply.send({ count });
    },
  );

  // POST /api/reference — add a pair by hand
  app.post<{
    Body: {
      game?: string;
      srcLang?: string;
      tgtLang?: string;
      sourceText?: string;
      translation?: string;
      note?: string | null;
    };
  }>('/api/reference', async (req, reply) => {
    const body = req.body ?? {};
    const sourceText = body.sourceText?.trim();
    const translation = body.translation?.trim();
    if (!sourceText) return reply.code(400).send({ error: 'sourceText is required' });
    if (!translation) return reply.code(400).send({ error: 'translation is required' });
    const row = await addManualReferenceTranslation(db, {
      game: body.game,
      srcLang: body.srcLang || CONFIG.defaultSrcLang,
      tgtLang: body.tgtLang || CONFIG.defaultTgtLang,
      sourceText,
      translation,
      note: body.note ?? null,
    });
    log.info(`POST /api/reference game=${row.game} ${row.src_lang}→${row.tgt_lang} id=${row.id}`);
    return reply.code(201).send(row);
  });

  // PUT /api/reference/:id — edit source, translation or note
  app.put<{
    Params: { id: string };
    Body: { sourceText?: string; translation?: string; note?: string | null };
  }>('/api/reference/:id', async (req, reply) => {
    const id = parseRouteId(req.params.id);
    if (id === null) return reply.code(400).send({ error: 'Invalid id' });
    const body = req.body ?? {};
    if (body.sourceText !== undefined && !body.sourceText.trim()) {
      return reply.code(400).send({ error: 'sourceText cannot be empty' });
    }
    if (body.translation !== undefined && !body.translation.trim()) {
      return reply.code(400).send({ error: 'translation cannot be empty' });
    }
    try {
      const row = await updateReferenceTranslation(db, id, body);
      if (!row) return reply.code(404).send({ error: 'Not found' });
      return reply.send(row);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        return reply
          .code(409)
          .send({ error: 'A reference row with this source text already exists' });
      }
      throw error;
    }
  });

  // DELETE /api/reference/:id
  app.delete<{ Params: { id: string } }>('/api/reference/:id', async (req, reply) => {
    const id = parseRouteId(req.params.id);
    if (id === null) return reply.code(400).send({ error: 'Invalid id' });
    const deleted = await deleteReferenceTranslations(db, [id]);
    if (deleted === 0) return reply.code(404).send({ error: 'Not found' });
    return reply.send({ ok: true });
  });

  // POST /api/reference/batch-delete { ids }
  app.post<{ Body: { ids?: number[] } }>('/api/reference/batch-delete', async (req, reply) => {
    const ids = parseIdList(req.body?.ids);
    if (!ids) return reply.code(400).send({ error: 'ids array is required' });
    const deleted = await deleteReferenceTranslations(db, ids);
    return reply.send({ ok: true, deleted });
  });

  /**
   * POST /api/reference/promote — copy live translations into the base.
   *
   * Body: `{ modIds }` or `{ stringIds }`, optional `targetLang` and
   * `statuses` (default reviewed + human). A row edited by hand on the
   * Reference page is never overwritten.
   */
  app.post<{
    Body: { modIds?: number[]; stringIds?: number[]; targetLang?: string; statuses?: string[] };
  }>('/api/reference/promote', async (req, reply) => {
    const body = req.body ?? {};
    const modIds = body.modIds !== undefined ? parseIdList(body.modIds) : undefined;
    const stringIds = body.stringIds !== undefined ? parseIdList(body.stringIds) : undefined;
    if (modIds === null || stringIds === null || (!modIds && !stringIds)) {
      return reply.code(400).send({ error: 'modIds or stringIds array is required' });
    }
    if (modIds && stringIds) {
      return reply.code(400).send({ error: 'Pass modIds or stringIds, not both' });
    }
    const statuses = body.statuses ?? REFERENCE_PROMOTE_STATUSES;
    if (
      !Array.isArray(statuses) ||
      statuses.length === 0 ||
      !statuses.every((s) => typeof s === 'string' && isValidTranslationStatus(s))
    ) {
      return reply.code(400).send({ error: 'Invalid statuses' });
    }
    const targetLang = body.targetLang ?? CONFIG.defaultTgtLang;
    const promoted = await promoteTranslationsToReference(db, {
      ...(modIds ? { modIds } : { stringIds: stringIds! }),
      targetLang,
      statuses,
      origin: 'promote',
    });
    log.info(
      `POST /api/reference/promote ${modIds ? `mods=${modIds.join(',')}` : `strings=${stringIds!.length}`} lang=${targetLang} promoted=${promoted}`,
    );
    return reply.send({ ok: true, promoted });
  });
};
