import { describe, expect, it } from '@jest/globals';
import { insertMod, useTestDb } from '../../testing/testDb';
import {
  loadClipEffort,
  loadClipEffortFeatures,
  loadSpeakerClipEffort,
  loadSpeakerEffortBaselines,
  loadVoiceEffortTags,
  saveClipEffort,
  saveEffortTagOverride,
  type ClipEffortRow,
} from '../voiceEffortStore';
import { voiceSynthesisStateKey } from '../voiceSynthesisState';

const take = (over: Partial<ClipEffortRow>): ClipEffortRow => ({
  speakerKey: 'RaiderMale01',
  lineKey: '021B2A',
  variant: 1,
  originPlugin: 'Fallout4.esm',
  features: { f0MedianSt: 22.5, brightnessDb: -4.1, voicedRatio: 0.8 },
  strength: 2.7,
  tag: 'shouting',
  ...over,
});

const raider = {
  speakerKey: 'RaiderMale01',
  lineKey: '021b2a',
  variant: 1,
  originPlugin: 'Fallout4.esm',
};
const raiderKey = voiceSynthesisStateKey('RaiderMale01', '021B2A', 1, 'fallout4.esm');

describe('effort tag override', () => {
  const db = useTestDb();

  it('wins over the derived tag and survives a new analysis', async () => {
    const modId = await insertMod(db());
    await saveClipEffort(db(), modId, [take({})]);

    expect(await saveEffortTagOverride(db(), modId, raider, 'loud')).toEqual({
      strength: 2.7,
      tag: 'shouting',
      override: 'loud',
    });
    expect((await loadVoiceEffortTags(db(), modId)).get(raiderKey)).toBe('loud');

    // Analysis rewrites the measurement and the decision, never the person's choice.
    await saveClipEffort(db(), modId, [take({ strength: 1.0, tag: null })]);
    expect(await loadClipEffort(db(), modId, raider)).toEqual({
      strength: 1.0,
      tag: null,
      override: 'loud',
    });
    expect((await loadVoiceEffortTags(db(), modId)).get(raiderKey)).toBe('loud');
  });

  it('"none" takes the derived tag away and clearing gives it back', async () => {
    const modId = await insertMod(db());
    await saveClipEffort(db(), modId, [take({})]);

    await saveEffortTagOverride(db(), modId, raider, 'none');
    expect((await loadVoiceEffortTags(db(), modId)).size).toBe(0);

    const cleared = await saveEffortTagOverride(db(), modId, raider, null);
    expect(cleared).toEqual({ strength: 2.7, tag: 'shouting', override: null });
    expect((await loadVoiceEffortTags(db(), modId)).get(raiderKey)).toBe('shouting');
  });

  it('tags a take of a mod never analyzed without making it look measured', async () => {
    const modId = await insertMod(db());

    expect(await saveEffortTagOverride(db(), modId, raider, 'shouting')).toEqual({
      strength: null,
      tag: null,
      override: 'shouting',
    });
    expect((await loadVoiceEffortTags(db(), modId)).get(raiderKey)).toBe('shouting');
    // Analysis still has to measure it, and the speaker is not "analyzed".
    expect((await loadClipEffortFeatures(db(), modId)).size).toBe(0);
    expect((await loadSpeakerEffortBaselines(db(), modId)).size).toBe(0);

    // Measured later: the choice stays.
    await saveClipEffort(db(), modId, [take({ tag: null, strength: 0.4 })]);
    expect(await loadClipEffort(db(), modId, raider)).toEqual({
      strength: 0.4,
      tag: null,
      override: 'shouting',
    });
    expect((await loadClipEffortFeatures(db(), modId)).size).toBe(1);
  });

  it('drops a row that held nothing but the choice once it is cleared', async () => {
    const modId = await insertMod(db());
    await saveEffortTagOverride(db(), modId, raider, 'loud');

    expect(await saveEffortTagOverride(db(), modId, raider, null)).toEqual({
      strength: null,
      tag: null,
      override: null,
    });
    const { rows } = await db().query(`SELECT 1 FROM voice_clip_effort WHERE mod_id = $1`, [modId]);
    expect(rows).toHaveLength(0);
  });

  it('lists one speaker with the key synthesis looks tags up by', async () => {
    const modId = await insertMod(db());
    await saveClipEffort(db(), modId, [
      take({}),
      take({ lineKey: '0AAAAA', strength: 0.3, tag: null }),
      take({ speakerKey: 'RaiderFemale01' }),
    ]);
    await saveEffortTagOverride(db(), modId, { ...raider, lineKey: '0AAAAA' }, 'loud');

    const states = await loadSpeakerClipEffort(db(), modId, 'RaiderMale01');
    expect(states.size).toBe(2);
    expect(states.get(raiderKey)).toEqual({ strength: 2.7, tag: 'shouting', override: null });
    expect(states.get(voiceSynthesisStateKey('RaiderMale01', '0AAAAA', 1, 'fallout4.esm'))).toEqual(
      { strength: 0.3, tag: null, override: 'loud' },
    );
  });

  it('tells analyzed speakers with a calm baseline from those without one', async () => {
    const modId = await insertMod(db());
    await saveClipEffort(db(), modId, [
      take({}),
      // Too few calm lines: measured, never judged.
      take({ speakerKey: 'Codsworth', strength: null, tag: null }),
      take({ speakerKey: 'Codsworth', lineKey: '0BBBBB', strength: null, tag: null }),
    ]);
    // A choice alone does not make a speaker analyzed.
    await saveEffortTagOverride(db(), modId, { ...raider, speakerKey: 'Piper' }, 'loud');

    const baselines = await loadSpeakerEffortBaselines(db(), modId);
    expect([...baselines].sort()).toEqual([
      ['Codsworth', false],
      ['RaiderMale01', true],
    ]);
  });
});
