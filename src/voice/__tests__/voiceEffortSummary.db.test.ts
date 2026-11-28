import { describe, expect, it } from '@jest/globals';
import { insertMod, useTestDb } from '../../testing/testDb';
import { loadVoiceEffortGameSummary } from '../voiceEffortSummary';
import { saveClipEffort, type ClipEffortRow } from '../voiceEffortStore';
import { upsertVoiceSynthesisState } from '../voiceSynthesisState';

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

const stamp = async (
  db: Parameters<typeof upsertVoiceSynthesisState>[0],
  modId: number,
  over: { lineKey: string; speakerKey?: string; originPlugin?: string; targetLang?: string },
) =>
  upsertVoiceSynthesisState(db, {
    modId,
    lineKey: over.lineKey,
    variant: 1,
    targetLang: over.targetLang ?? 'uk',
    speakerKey: over.speakerKey ?? 'RaiderMale01',
    originPlugin: over.originPlugin ?? 'Fallout4.esm',
    ttsTextVersion: 'v1',
  });

describe('loadVoiceEffortGameSummary', () => {
  const db = useTestDb();

  it('reports nothing for a game whose mods were never analyzed', async () => {
    await insertMod(db(), { game: 'fo4' });
    expect(await loadVoiceEffortGameSummary(db(), 'fo4')).toEqual({
      analyzedMods: 0,
      taggedTakes: 0,
      synthesizedTaggedTakes: 0,
    });
  });

  it('counts the tagged takes and those a synthesized take would go stale for', async () => {
    const modA = await insertMod(db(), { game: 'fo4' });
    const modB = await insertMod(db(), { game: 'fo4' });
    const other = await insertMod(db(), { game: 'sf1' });
    await saveClipEffort(db(), modA, [
      take({ lineKey: '000001' }),
      take({ lineKey: '000002', tag: 'loud' }),
      take({ lineKey: '000003', strength: 0.4, tag: null }),
      take({ lineKey: '000004' }),
    ]);
    await saveClipEffort(db(), modB, [take({ lineKey: '000005', strength: 0.1, tag: null })]);
    await saveClipEffort(db(), other, [take({ lineKey: '000006' })]);
    // A person took the tag off one line and put one on another.
    await db().query(
      `UPDATE voice_clip_effort SET tag_override = 'none' WHERE mod_id = $1 AND line_key = '000004'`,
      [modA],
    );
    await db().query(
      `UPDATE voice_clip_effort SET tag_override = 'loud' WHERE mod_id = $1 AND line_key = '000005'`,
      [modB],
    );

    // 000001 synthesized in two languages still is one take going stale.
    await stamp(db(), modA, { lineKey: '000001' });
    await stamp(db(), modA, { lineKey: '000001', targetLang: 'de' });
    // A stamp from before speakers and origins were recorded stands for the take.
    await stamp(db(), modB, { lineKey: '000005', speakerKey: '', originPlugin: '' });
    // Untagged, or another speaker's take of the same line: not stale.
    await stamp(db(), modA, { lineKey: '000003' });
    await stamp(db(), modA, { lineKey: '000002', speakerKey: 'RaiderFemale01' });
    await stamp(db(), other, { lineKey: '000006' });

    expect(await loadVoiceEffortGameSummary(db(), 'fo4')).toEqual({
      analyzedMods: 2,
      taggedTakes: 3,
      synthesizedTaggedTakes: 2,
    });
    expect(await loadVoiceEffortGameSummary(db(), 'sf1')).toEqual({
      analyzedMods: 1,
      taggedTakes: 1,
      synthesizedTaggedTakes: 1,
    });
  });
});
