import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../../db';
import { reuseSynthesizedVoice } from '../../../voice/reuseSynthesizedVoice';
import { diffMods, carryOverTranslations } from '../../data/queries';
import { log } from '../../../logger';
import { CONFIG } from '../../../config';
import { invalidateVoiceListContext } from '../../voice/preview/voiceListContext';

export const registerDiffCarryOverRoutes = async (app: FastifyInstance, db: Tx) => {
  // GET /api/mods/:id/diff?compareModId= — compare two mod versions
  app.get<{ Params: { id: string }; Querystring: { compareModId?: string; targetLang?: string } }>(
    '/api/mods/:id/diff',
    async (req, reply) => {
      const newId = Number(req.params.id);
      const oldId = Number(req.query.compareModId);
      if (!Number.isInteger(newId) || newId < 1)
        return reply.code(400).send({ error: 'Invalid mod id' });
      if (!Number.isInteger(oldId) || oldId < 1)
        return reply.code(400).send({ error: 'compareModId is required' });

      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      const result = await diffMods(db, newId, oldId, targetLang);
      return reply.send(result);
    },
  );

  // POST /api/mods/:id/carry-over?fromModId=&targetLang= — copy translations from old mod version
  app.post<{ Params: { id: string }; Querystring: { fromModId?: string; targetLang?: string } }>(
    '/api/mods/:id/carry-over',
    async (req, reply) => {
      const newModId = Number(req.params.id);
      const oldModId = Number(req.query.fromModId);
      if (!Number.isInteger(newModId) || newModId < 1)
        return reply.code(400).send({ error: 'Invalid mod id' });
      if (!Number.isInteger(oldModId) || oldModId < 1)
        return reply.code(400).send({ error: 'fromModId query param is required' });

      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      log.info(
        `POST /api/mods/${newModId}/carry-over fromModId=${oldModId} targetLang=${targetLang}`,
      );

      try {
        const result = await carryOverTranslations(db, newModId, oldModId, targetLang);
        const voice = await reuseSynthesizedVoice(db, newModId, targetLang, {
          sourceModIds: [oldModId],
        });
        if (voice.copied > 0) invalidateVoiceListContext(newModId);
        log.info(
          `Carry-over voice: copied ${voice.copied} take(s) from mod ${oldModId} to ${newModId}`,
        );
        return reply.send({ ...result, voiceCopied: voice.copied });
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
};
