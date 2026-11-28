import { describe, expect, it } from '@jest/globals';
import { registerVoiceEffortRoutes } from '../voiceEffort';
import { insertMod, useTestDb } from '../../../../testing/testDb';
import { useTestApp } from '../../../../testing/testApp';
import { loadVoiceEffortTags, saveClipEffort } from '../../../../voice/voiceEffortStore';
import { voiceSynthesisStateKey } from '../../../../voice/voiceSynthesisState';

const url = (modId: number | string) => `/api/mods/${modId}/voice/effort-override`;
const body = {
  speakerKey: 'RaiderMale01',
  lineKey: '021B2A',
  variant: 1,
  originPlugin: 'Fallout4.esm',
  choice: 'none',
};

describe('PUT /api/mods/:id/voice/effort-override', () => {
  const db = useTestDb();
  const app = useTestApp(db, registerVoiceEffortRoutes);

  it.each([
    ['a mod id', 'abc', body, 'Invalid mod id'],
    ['a speaker', 1, { ...body, speakerKey: ' ' }, 'speakerKey is required'],
    ['a line key', 1, { ...body, lineKey: '../x' }, 'Invalid formid'],
    ['a variant', 1, { ...body, variant: 0 }, 'Invalid variant'],
    [
      'a choice',
      1,
      { ...body, choice: 'screaming' },
      'choice must be auto, none, loud or shouting',
    ],
  ])('answers 400 without %s', async (_what, modId, payload, error) => {
    const res = await app().inject({ method: 'PUT', url: url(modId), payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error });
  });

  it('answers 404 for a mod that does not exist', async () => {
    const res = await app().inject({ method: 'PUT', url: url(999_999), payload: body });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, reason: 'mod_not_found' });
  });

  it('stores the choice and answers with the line as the editor shows it', async () => {
    const modId = await insertMod(db(), { game: 'fo4' });
    await saveClipEffort(db(), modId, [
      {
        speakerKey: 'RaiderMale01',
        lineKey: '021B2A',
        variant: 1,
        originPlugin: 'Fallout4.esm',
        features: { f0MedianSt: 22.5, brightnessDb: -4.1, voicedRatio: 0.8 },
        strength: 2.71,
        tag: 'shouting',
      },
    ]);

    const res = await app().inject({ method: 'PUT', url: url(modId), payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      effortTag: null,
      effortAutoTag: 'shouting',
      effortOverride: 'none',
      effortStrength: 2.71,
    });
    expect((await loadVoiceEffortTags(db(), modId)).size).toBe(0);

    const back = await app().inject({
      method: 'PUT',
      url: url(modId),
      payload: { ...body, choice: 'auto' },
    });
    expect(back.json()).toMatchObject({ effortTag: 'shouting', effortOverride: null });
    expect(
      (await loadVoiceEffortTags(db(), modId)).get(
        voiceSynthesisStateKey('RaiderMale01', '021B2A', 1, 'fallout4.esm'),
      ),
    ).toBe('shouting');
  });

  it('refuses a game that never tags lines', async () => {
    const modId = await insertMod(db(), { game: 'disco' });
    const res = await app().inject({ method: 'PUT', url: url(modId), payload: body });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, reason: 'effort_tags_unsupported' });
  });
});
