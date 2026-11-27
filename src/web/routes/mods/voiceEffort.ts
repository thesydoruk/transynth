import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../../db';
import { isVoiceFormidKey } from '../../../voice/voiceFormidKey';
import { parseRouteId } from '../parseRouteId';
import { parseVoiceEffortChoice, setVoiceLineEffortChoice } from '../../voice/preview';

export const registerVoiceEffortRoutes = async (app: FastifyInstance, db: Tx) => {
  // PUT /api/mods/:id/voice/effort-override — a person's effort tag for one take.
  // `choice` is 'auto' (the analysis decides), 'none', 'loud' or 'shouting'.
  app.put<{
    Params: { id: string };
    Body: {
      speakerKey?: string;
      lineKey?: string;
      variant?: number;
      originPlugin?: string | null;
      choice?: string;
    };
  }>('/api/mods/:id/voice/effort-override', async (req, reply) => {
    const modId = parseRouteId(req.params.id);
    if (modId === null) {
      return reply.code(400).send({ error: 'Invalid mod id' });
    }
    const speakerKey = req.body?.speakerKey?.trim();
    const lineKey = req.body?.lineKey?.trim();
    const variant = req.body?.variant;
    const choice = parseVoiceEffortChoice(req.body?.choice);
    if (!speakerKey) {
      return reply.code(400).send({ error: 'speakerKey is required' });
    }
    if (!lineKey || !isVoiceFormidKey(lineKey)) {
      return reply.code(400).send({ error: 'Invalid formid' });
    }
    if (typeof variant !== 'number' || !Number.isInteger(variant) || variant < 1) {
      return reply.code(400).send({ error: 'Invalid variant' });
    }
    if (!choice) {
      return reply.code(400).send({ error: 'choice must be auto, none, loud or shouting' });
    }

    const result = await setVoiceLineEffortChoice(
      db,
      modId,
      { speakerKey, lineKey, variant, originPlugin: req.body?.originPlugin },
      choice,
    );
    if (!result.ok) {
      return reply.code(result.reason === 'mod_not_found' ? 404 : 400).send(result);
    }
    return reply.send(result);
  });
};
