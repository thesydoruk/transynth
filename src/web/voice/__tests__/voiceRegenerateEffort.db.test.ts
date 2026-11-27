import { describe, expect, it } from '@jest/globals';
import { insertMod, useTestDb } from '../../../testing/testDb';
import { setProjectSetting } from '../../services/projectSettings';
import {
  loadClipEffort,
  saveClipEffort,
  saveEffortTagOverride,
} from '../../../voice/voiceEffortStore';
import { keepRegenerateEffort, resolveRegenerateEffort } from '../voiceRegenerateEffort';

const line = {
  speakerKey: 'RaiderMale01',
  lineKey: '021B2A',
  variant: 1,
  originPlugin: 'Fallout4.esm',
};

const seed = async (db: Parameters<typeof saveClipEffort>[0], modId: number) =>
  saveClipEffort(db, modId, [
    {
      ...line,
      features: { f0MedianSt: 22.5, brightnessDb: -4.1, voicedRatio: 0.8 },
      strength: 2.7,
      tag: 'shouting',
    },
  ]);

const switchOn = (db: Parameters<typeof setProjectSetting>[0]) =>
  setProjectSetting(db, 'voice.game_tts', {
    fo4: { matchLoudness: true, matchTiming: true, effortTags: true },
  });

describe('regenerate effort choice', () => {
  const db = useTestDb();

  it('applies no choice while the game has tags off', async () => {
    const modId = await insertMod(db(), { game: 'fo4' });
    await seed(db(), modId);
    expect(await resolveRegenerateEffort(db(), modId, 'fo4', 'none', line)).toBeNull();
  });

  it('applies no choice to a game that never tags lines', async () => {
    const modId = await insertMod(db(), { game: 'disco' });
    await setProjectSetting(db(), 'voice.game_tts', {
      disco: { matchLoudness: true, matchTiming: true, effortTags: true },
    });
    expect(await resolveRegenerateEffort(db(), modId, 'disco', 'loud', line)).toBeNull();
  });

  it('synthesizes "auto" with the derived tag even over a choice made before', async () => {
    const modId = await insertMod(db(), { game: 'fo4' });
    await seed(db(), modId);
    await switchOn(db());
    await saveEffortTagOverride(db(), modId, line, 'none');

    expect(await resolveRegenerateEffort(db(), modId, 'fo4', 'auto', line)).toEqual({
      effortTag: 'shouting',
      effort: { choice: 'auto', speakerKey: 'RaiderMale01', originPlugin: 'fallout4.esm' },
    });
    expect(await resolveRegenerateEffort(db(), modId, 'fo4', 'none', line)).toMatchObject({
      effortTag: null,
    });
    expect(await resolveRegenerateEffort(db(), modId, 'fo4', undefined, line)).toBeNull();
  });

  it('keeping a preview stores its choice as the line override', async () => {
    const modId = await insertMod(db(), { game: 'fo4' });
    await seed(db(), modId);
    await switchOn(db());

    const loud = await resolveRegenerateEffort(db(), modId, 'fo4', 'loud', line);
    await keepRegenerateEffort(db(), modId, line.lineKey, line.variant, loud?.effort);
    expect((await loadClipEffort(db(), modId, line)).override).toBe('loud');

    const auto = await resolveRegenerateEffort(db(), modId, 'fo4', 'auto', line);
    await keepRegenerateEffort(db(), modId, line.lineKey, line.variant, auto?.effort);
    expect((await loadClipEffort(db(), modId, line)).override).toBeNull();
  });
});
