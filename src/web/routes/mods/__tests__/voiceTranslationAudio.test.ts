import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../../../db';
import type { VoiceRemoveLineResult } from '../../../voice/preview';

// The game registry (test setup) already evaluated the voice modules; start
// from an empty registry so the route links to the mock below.
jest.resetModules();

type Remove = (
  db: Tx,
  modId: number,
  lineKey: string,
  variant: number,
  srcLang: string,
  targetLang: string,
  speakerKey?: string,
  originPlugin?: string,
) => Promise<VoiceRemoveLineResult>;

const removeVoiceTranslationForMod = jest.fn<Remove>();
const invalidateVoiceListContext = jest.fn<(modId: number) => void>();
const unused = jest.fn();

jest.unstable_mockModule('../../../voice/preview', () => ({
  removeVoiceTranslationForMod,
  invalidateVoiceListContext,
  clearVoiceSpeakerReferenceForMod: unused,
  generateVoiceTranslationForMod: unused,
  getVoicePreviewWav: unused,
  getVoiceTranslationWav: unused,
  listVoiceAvailabilityForMod: unused,
  listVoiceLinesForSpeaker: unused,
  listVoiceSpeakersForMod: unused,
  setVoiceSpeakerReferenceForMod: unused,
}));

const Fastify = (await import('fastify')).default;
const { registerVoiceRoutes } = await import('../voice');

const db = {} as Tx;
const url = '/api/mods/7/voice/translation-audio/825D9B/1';

describe('DELETE /api/mods/:id/voice/translation-audio/:lineKey/:variant', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await registerVoiceRoutes(app, db);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    removeVoiceTranslationForMod.mockReset();
    invalidateVoiceListContext.mockReset();
  });

  it('removes the take of the line the query names and drops the cached list', async () => {
    removeVoiceTranslationForMod.mockResolvedValue({ ok: true, takesRemoved: 1, stampsRemoved: 1 });

    const res = await app.inject({
      method: 'DELETE',
      url: `${url}?srcLang=en&targetLang=uk&speakerKey=DemoVoice&originPlugin=%20Demo.ESP%20`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, takesRemoved: 1, stampsRemoved: 1 });
    expect(removeVoiceTranslationForMod).toHaveBeenCalledWith(
      db,
      7,
      '825D9B',
      1,
      'en',
      'uk',
      'DemoVoice',
      'demo.esp',
    );
    expect(invalidateVoiceListContext).toHaveBeenCalledWith(7);
  });

  it('answers ok for a line without a take', async () => {
    removeVoiceTranslationForMod.mockResolvedValue({ ok: true, takesRemoved: 0, stampsRemoved: 0 });

    const res = await app.inject({ method: 'DELETE', url });

    expect(res.statusCode).toBe(200);
    expect(invalidateVoiceListContext).toHaveBeenCalledWith(7);
  });

  it.each([
    ['mod_not_found', 404],
    ['line_not_found', 404],
    ['plugin_missing', 400],
  ] as const)('answers %s with %i and keeps the cached list', async (reason, status) => {
    removeVoiceTranslationForMod.mockResolvedValue({ ok: false, reason, message: reason });

    const res = await app.inject({ method: 'DELETE', url });

    expect(res.statusCode).toBe(status);
    expect(invalidateVoiceListContext).not.toHaveBeenCalled();
  });

  it.each([
    ['/api/mods/7/voice/translation-audio/bad.key/1', 'Invalid formid'],
    ['/api/mods/7/voice/translation-audio/825D9B/0', 'Invalid variant'],
  ])('rejects %s', async (badUrl, error) => {
    const res = await app.inject({ method: 'DELETE', url: badUrl });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error });
    expect(removeVoiceTranslationForMod).not.toHaveBeenCalled();
  });
});
