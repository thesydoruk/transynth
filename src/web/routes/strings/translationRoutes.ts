import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../../db';
import { upsertTranslation, deleteTranslation, getStringTextNorm } from '../../data/queries';
import { getAllProjectSettings } from '../../services/projectSettings';
import { propagateTranslation } from '../../services/tm';
import { CONFIG } from '../../../config';

export const registerTranslationRoutes = async (app: FastifyInstance, db: Tx) => {
  // PATCH /api/strings/:stringId/translation — save inline edit
  app.patch<{
    Params: { stringId: string };
    Body: {
      text: string;
      status?: 'draft' | 'reviewed' | 'rejected' | 'human' | 'fuzzy' | 'auto' | 'tm' | 'skip';
      targetLang?: string;
    };
  }>('/api/strings/:stringId/translation', async (req, reply) => {
    const stringId = Number(req.params.stringId);
    if (!Number.isInteger(stringId) || stringId < 1) {
      return reply.code(400).send({ error: 'Invalid string id' });
    }

    const { text, status = 'draft', targetLang = CONFIG.defaultTgtLang } = req.body ?? {};
    if (typeof text !== 'string') {
      return reply.code(400).send({ error: 'text is required' });
    }

    if (text.trim() === '') {
      return reply.send(await deleteTranslation(db, stringId, targetLang));
    }

    // Read project settings to determine effective save status and propagation.
    const projectSettings = await getAllProjectSettings(db);

    // When auto_approve_on_save is enabled and the client submitted a regular
    // draft save, promote the status directly to reviewed so the string skips
    // the review queue.
    const effectiveStatus: typeof status =
      projectSettings['workflow.auto_approve_on_save'] && status === 'draft' ? 'reviewed' : status;

    const result = await upsertTranslation(
      db,
      stringId,
      text,
      effectiveStatus,
      targetLang,
      undefined,
      undefined,
      req.user?.id ?? null,
    );

    // Propagate to all strings with the same normalised source text (unless disabled).
    if (projectSettings['workflow.propagate_to_identical']) {
      const textNorm = await getStringTextNorm(db, stringId);
      if (textNorm) {
        await propagateTranslation(db, textNorm, text, targetLang, stringId);
      }
    }

    return reply.send(result);
  });

  // DELETE /api/strings/:stringId/translation?targetLang=
  app.delete<{ Params: { stringId: string }; Querystring: { targetLang?: string } }>(
    '/api/strings/:stringId/translation',
    async (req, reply) => {
      const stringId = Number(req.params.stringId);
      if (!Number.isInteger(stringId) || stringId < 1) {
        return reply.code(400).send({ error: 'Invalid string id' });
      }
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      return reply.send(await deleteTranslation(db, stringId, targetLang));
    },
  );

  // PATCH /api/strings/:stringId/ignore — toggle the is_ignored flag
  //
  // Marking a string as ignored excludes it from the default editor view when
  // the `workflow.hide_ignored_by_default` project setting is enabled.
  // Body: { ignore: boolean }
  app.patch<{
    Params: { stringId: string };
    Body: { ignore: boolean };
  }>('/api/strings/:stringId/ignore', async (req, reply) => {
    const stringId = Number(req.params.stringId);
    if (!Number.isInteger(stringId) || stringId < 1) {
      return reply.code(400).send({ error: 'Invalid string id' });
    }
    const { ignore } = req.body ?? {};
    if (typeof ignore !== 'boolean') {
      return reply.code(400).send({ error: 'ignore (boolean) is required' });
    }
    const { rows } = await db.query<{ id: number; is_ignored: boolean }>(
      `UPDATE strings SET is_ignored = $2 WHERE id = $1 RETURNING id, is_ignored`,
      [stringId, ignore],
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'String not found' });
    return reply.send(rows[0]);
  });
};
