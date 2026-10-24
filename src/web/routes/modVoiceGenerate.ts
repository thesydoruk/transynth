import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import {
  findActiveJobIdForMod,
  readJobStatus,
  stopJobForMod,
  stopJobOfKind,
} from '../../../worker/src/api/jobStatus';
import { startJobSse } from '../../../worker/src/api/startJobSse';
import { clampTtsRetries, clampTtsRetryBelow } from '../../tts/ttsSynthesisParams';
import type { VoiceResynthJobInput } from '../../voice/voiceResynth';

type VoiceGenerateBody = {
  srcLang?: string;
  targetLang?: string;
  scope?: 'all' | 'missing' | 'low-similarity';
  speakerKey?: string;
  /** `low-similarity` only: the dialog's fields. */
  similarityBelow?: number;
  targetSimilarity?: number;
  retries?: number;
  noWorse?: boolean;
};

const isScore = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/** The `low-similarity` fields, or the reason they are not acceptable. */
export const parseVoiceResynthBody = (
  body: VoiceGenerateBody,
): { ok: true; params: VoiceResynthJobInput } | { ok: false; error: string } => {
  const { similarityBelow, targetSimilarity, retries, noWorse } = body;
  if (!isScore(similarityBelow)) {
    return { ok: false, error: 'similarityBelow must be a number between 0 and 1' };
  }
  if (!isScore(targetSimilarity)) {
    return { ok: false, error: 'targetSimilarity must be a number between 0 and 1' };
  }
  if (typeof retries !== 'number' || clampTtsRetries(retries) !== retries) {
    return { ok: false, error: `retries must be an integer between 0 and ${clampTtsRetries(99)}` };
  }
  if (noWorse != null && typeof noWorse !== 'boolean') {
    return { ok: false, error: 'noWorse must be a boolean' };
  }
  return {
    ok: true,
    params: {
      similarityBelow: clampTtsRetryBelow(similarityBelow),
      targetSimilarity: clampTtsRetryBelow(targetSimilarity),
      retries,
      noWorse: noWorse ?? true,
    },
  };
};

export const modVoiceGenerateRoutes = async (app: FastifyInstance, db: Tx) => {
  // POST /api/mods/:modId/voice-generate — `scope=all` wipes this mod's voice, then runs
  // missing; `scope=low-similarity` re-synthesizes takes scored below `similarityBelow`.
  app.post<{
    Params: { modId: string };
    Body: VoiceGenerateBody;
  }>('/api/mods/:modId/voice-generate', async (req, reply) => {
    const modId = Number(req.params.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid modId' });
    }

    const srcLang = req.body?.srcLang?.trim() || CONFIG.defaultSrcLang;
    const targetLang = req.body?.targetLang?.trim() || CONFIG.defaultTgtLang;
    const resetVoice = req.body?.scope === 'all';
    const speakerKey = req.body?.speakerKey?.trim() || undefined;
    let resynth: VoiceResynthJobInput | undefined;
    if (req.body?.scope === 'low-similarity') {
      const parsed = parseVoiceResynthBody(req.body);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
      resynth = parsed.params;
    }

    const running = await findActiveJobIdForMod(['voice-generate'], modId);
    if (running) {
      return reply
        .code(409)
        .send({ error: `Voice generation already running (job #${running.jobId})` });
    }

    const { rows: modRows } = await db.query<{ name: string; game: string }>(
      `SELECT name, game FROM mods WHERE id = $1`,
      [modId],
    );
    const mod = modRows[0];
    if (!mod) return reply.code(404).send({ error: 'Mod not found' });

    await startJobSse(req, reply, {
      data: {
        kind: 'voice-generate',
        modId,
        params: {
          srcLang,
          targetLang,
          game: mod.game,
          modName: mod.name,
          scope: resynth ? 'low-similarity' : 'missing',
          ...(resetVoice ? { resetVoice: true } : {}),
          ...(speakerKey ? { speakerKey } : {}),
          ...(resynth ?? {}),
        },
      },
      initialSnapshotData: { written: 0, skipped: 0, warningCount: 0 },
    });
  });

  // How many stamped takes score below a threshold — what the dialog shows before
  // a `low-similarity` job starts. Counts stamps, so a take whose file is gone or
  // that was never scored is not in it; the job's own total is authoritative.
  app.get<{
    Params: { modId: string };
    Querystring: { targetLang?: string; below?: string; speakerKey?: string };
  }>('/api/mods/:modId/voice-low-similarity-count', async (req, reply) => {
    const modId = Number(req.params.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid modId' });
    }
    const below = Number(req.query.below);
    if (!isScore(below)) {
      return reply.code(400).send({ error: 'below must be a number between 0 and 1' });
    }
    const targetLang = (req.query.targetLang?.trim() || CONFIG.defaultTgtLang).toLowerCase();
    const speakerKey = req.query.speakerKey?.trim() || null;
    const { rows } = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM voice_synthesis_state
       WHERE mod_id = $1 AND target_lang = $2 AND voice_similarity < $3
         AND ($4::text IS NULL OR speaker_key = $4)`,
      [modId, targetLang, below, speakerKey],
    );
    return reply.send({ count: Number(rows[0]?.count ?? 0) });
  });

  app.post<{ Params: { jobId: string } }>('/api/voice-generate/:jobId/stop', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    if (!(await stopJobOfKind(jobId, ['voice-generate']))) {
      return reply.code(404).send({ error: 'Running voice generation job not found' });
    }
    return reply.send({ ok: true });
  });

  app.post<{ Params: { modId: string } }>(
    '/api/mods/:modId/voice-generate/stop',
    async (req, reply) => {
      const modId = Number(req.params.modId);
      if (!Number.isInteger(modId) || modId < 1) {
        return reply.code(400).send({ error: 'Invalid modId' });
      }
      if (!(await stopJobForMod(['voice-generate'], modId))) {
        return reply.code(404).send({ error: 'Running voice generation job not found' });
      }
      return reply.send({ ok: true });
    },
  );

  app.get<{ Params: { jobId: string } }>('/api/voice-generate/:jobId', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    const job = await readJobStatus(jobId, ['voice-generate']);
    if (!job) return reply.code(404).send({ error: 'Voice generation job not found' });
    return reply.send(job);
  });
};
