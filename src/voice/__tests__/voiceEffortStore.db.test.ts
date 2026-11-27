import { describe, expect, it } from '@jest/globals';
import { insertMod, useTestDb } from '../../testing/testDb';
import { setProjectSetting } from '../../web/services/projectSettings';
import {
  loadClipEffortFeatures,
  loadVoiceEffortTags,
  saveClipEffort,
  type ClipEffortRow,
} from '../voiceEffortStore';
import { loadActiveVoiceEffortTags, lookupVoiceEffortTag } from '../voiceEffortTags';
import { voiceSynthesisStateKey } from '../voiceSynthesisState';

const take = (over: Partial<ClipEffortRow>): ClipEffortRow => ({
  speakerKey: 'RaiderMale01',
  lineKey: '021b2a',
  variant: 1,
  originPlugin: 'Fallout4.esm',
  features: { f0MedianSt: 22.5, brightnessDb: -4.1, voicedRatio: 0.8 },
  strength: 2.7,
  tag: 'shouting',
  ...over,
});

describe('voice_clip_effort', () => {
  const db = useTestDb();

  it('keeps the features of a take and the tag derived from them', async () => {
    const modId = await insertMod(db());
    await saveClipEffort(db(), modId, [
      take({}),
      take({ lineKey: '0AAAAA', strength: 0.2, tag: null }),
      // Too little speech to measure: remembered, so it is not decoded again.
      take({ lineKey: '0BBBBB', features: null, strength: null, tag: null }),
    ]);

    const features = await loadClipEffortFeatures(db(), modId);
    expect(features.size).toBe(3);
    expect(
      features.get(voiceSynthesisStateKey('RaiderMale01', '021B2A', 1, 'fallout4.esm')),
    ).toEqual({ f0MedianSt: 22.5, brightnessDb: -4.1, voicedRatio: 0.8 });
    expect(
      features.get(voiceSynthesisStateKey('RaiderMale01', '0BBBBB', 1, 'fallout4.esm')),
    ).toBeNull();

    const tags = await loadVoiceEffortTags(db(), modId);
    expect([...tags]).toEqual([
      [voiceSynthesisStateKey('RaiderMale01', '021B2A', 1, 'fallout4.esm'), 'shouting'],
    ]);
  });

  it('replaces the decision of a take analyzed again', async () => {
    const modId = await insertMod(db());
    await saveClipEffort(db(), modId, [take({})]);
    await saveClipEffort(db(), modId, [take({ strength: 1.1, tag: null })]);

    expect((await loadClipEffortFeatures(db(), modId)).size).toBe(1);
    expect((await loadVoiceEffortTags(db(), modId)).size).toBe(0);
  });

  it('hands tags to synthesis only for a game that switched them on', async () => {
    const modId = await insertMod(db(), { game: 'fo4' });
    await saveClipEffort(db(), modId, [take({})]);

    expect((await loadActiveVoiceEffortTags(db(), modId, 'fo4')).size).toBe(0);

    await setProjectSetting(db(), 'voice.game_tts', {
      fo4: { matchLoudness: true, matchTiming: true, effortTags: true },
    });
    const tags = await loadActiveVoiceEffortTags(db(), modId, 'fo4');
    expect(lookupVoiceEffortTag(tags, 'RaiderMale01', '021b2a', 1, 'Fallout4.esm')).toBe(
      'shouting',
    );
    expect(lookupVoiceEffortTag(tags, 'RaiderFemale01', '021B2A', 1, 'fallout4.esm')).toBeNull();
    // Another game keeps its own switch.
    expect((await loadActiveVoiceEffortTags(db(), modId, 'sf1')).size).toBe(0);
  });
});
