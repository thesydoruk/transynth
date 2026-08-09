import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import {
  clearCharacterUkVoiceLink,
  getUkVoiceById,
  listUkVoiceCharacters,
  listUkVoiceLibrary,
  runUkVoiceLibraryImport,
  setCharacterUkVoiceLink,
  ukVoiceAudioAbsPath,
} from '../../voice/ukLibrary';

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/** REST API for the Ukrainian reference voice library and global character links. */
export const ukVoiceLibraryRoutes = async (app: FastifyInstance, db: pg.Pool): Promise<void> => {
  app.get('/api/uk-voices', async () => {
    const voices = await listUkVoiceLibrary(db);
    return { voices };
  });

  app.get('/api/uk-voices/characters', async () => {
    const characters = await listUkVoiceCharacters(db);
    return { characters };
  });

  app.put<{
    Params: { characterKey: string };
    Body: { voiceId?: string; reason?: string };
  }>('/api/uk-voices/characters/:characterKey', async (req, reply) => {
    const characterKey = decodeURIComponent(req.params.characterKey).trim();
    const voiceId = req.body?.voiceId;
    if (!characterKey) return reply.code(400).send({ error: 'characterKey required' });
    if (!isNonEmptyString(voiceId)) return reply.code(400).send({ error: 'voiceId required' });
    await setCharacterUkVoiceLink(db, characterKey, voiceId.trim(), {
      reason: typeof req.body?.reason === 'string' ? req.body.reason : 'manual assignment',
      assignedBy: 'manual',
    });
    return { ok: true, characterKey, voiceId: voiceId.trim() };
  });

  app.delete<{ Params: { characterKey: string } }>(
    '/api/uk-voices/characters/:characterKey',
    async (req, reply) => {
      const characterKey = decodeURIComponent(req.params.characterKey).trim();
      if (!characterKey) return reply.code(400).send({ error: 'characterKey required' });
      const removed = await clearCharacterUkVoiceLink(db, characterKey);
      return { ok: true, removed };
    },
  );

  app.post<{ Body: { maxVoices?: number } }>('/api/uk-voices/import', async (req, reply) => {
    try {
      const maxVoices =
        typeof req.body?.maxVoices === 'number' && req.body.maxVoices > 0
          ? Math.min(Math.floor(req.body.maxVoices), 2000)
          : undefined;
      const result = await runUkVoiceLibraryImport(db, { maxVoices });
      return { ok: true, ...result };
    } catch (err) {
      return reply.code(500).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.get<{ Params: { id: string } }>('/api/uk-voices/:id/audio', async (req, reply) => {
    const voice = await getUkVoiceById(db, decodeURIComponent(req.params.id));
    if (!voice) return reply.code(404).send({ error: 'Voice not found' });
    const abs = ukVoiceAudioAbsPath(voice.audioRelPath);
    if (!fs.existsSync(abs)) return reply.code(404).send({ error: 'Audio file missing' });
    reply.type('audio/wav');
    return reply.send(fs.createReadStream(abs));
  });
};
