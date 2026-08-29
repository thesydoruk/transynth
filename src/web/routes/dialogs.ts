import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import { parseSpeakerGender, type SpeakerGender } from '../../dialog';
import {
  getDialogTranscript,
  listDialogGroups,
  listDialogSpeakers,
  listDialogSpeakerStringIds,
  parseDialogScope,
  refreshQAIssuesBatch,
  setDialogSpeakerGenderOverride,
} from '../data/queries';

/** Override values a client may send; `null` restores the detected gender. */
const parseGenderOverride = (value: unknown): SpeakerGender | null | undefined => {
  if (value === null) return null;
  const gender = parseSpeakerGender(value);
  return gender === 'unknown' ? undefined : gender;
};

/**
 * API of the dialogs editor.
 *
 * Two endpoints cover all four scopes (topics, branches, scenes, conversations):
 * one lists the selectable groups with their translation progress, the other
 * loads the transcript of a single group. Editing reuses the strings
 * translation API. A third pair exposes the speakers of a mod so a human can
 * correct the gender that import guessed.
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

  // GET /api/dialogs/speakers?modId=
  app.get<{ Querystring: { modId?: string } }>('/api/dialogs/speakers', async (req, reply) => {
    const modId = Number(req.query.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'modId is required' });
    }
    return reply.send(await listDialogSpeakers(db, modId));
  });

  // PATCH /api/dialogs/speakers/:speakerKey  { modId, gender }
  app.patch<{
    Params: { speakerKey: string };
    Body: { modId?: number; gender?: unknown; srcLang?: string; targetLang?: string };
  }>('/api/dialogs/speakers/:speakerKey', async (req, reply) => {
    const modId = Number(req.body?.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'modId is required' });
    }

    const gender = parseGenderOverride(req.body?.gender);
    if (gender === undefined) {
      return reply.code(400).send({ error: 'gender must be male, female, any, or null' });
    }

    const speakerKey = decodeURIComponent(req.params.speakerKey);
    const speaker = await setDialogSpeakerGenderOverride(db, modId, speakerKey, gender);
    if (!speaker) return reply.code(404).send({ error: 'speaker not found' });

    // Gendered wording is validated against the speaker, so the lines they take
    // part in have to be re-checked before the editor reloads them.
    const srcLang = req.body?.srcLang ?? CONFIG.defaultSrcLang;
    const targetLang = req.body?.targetLang ?? CONFIG.defaultTgtLang;
    const stringIds = await listDialogSpeakerStringIds(db, modId, speakerKey, srcLang);
    await refreshQAIssuesBatch(db, stringIds, targetLang, srcLang, { skipDuplicateCheck: true });

    return reply.send(speaker);
  });
};
