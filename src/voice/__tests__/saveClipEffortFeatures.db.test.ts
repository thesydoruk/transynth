import { describe, expect, it } from '@jest/globals';
import { insertMod, useTestDb } from '../../testing/testDb';
import { saveClipEffortFeatures } from '../saveClipEffortFeatures';
import { loadClipEffortFeatures, saveClipEffort, type ClipEffortRow } from '../voiceEffortStore';
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

describe('saveClipEffortFeatures', () => {
  const db = useTestDb();

  it('writes a new take without a decision and keeps the decision of a known one', async () => {
    const modId = await insertMod(db());
    await saveClipEffort(db(), modId, [take({ lineKey: '000001' })]);

    await saveClipEffortFeatures(db(), modId, [
      {
        speakerKey: 'RaiderMale01',
        lineKey: '000001',
        variant: 1,
        originPlugin: 'Fallout4.esm',
        features: { f0MedianSt: 25, brightnessDb: -2, voicedRatio: 0.9 },
      },
      {
        speakerKey: 'RaiderMale01',
        lineKey: '000002',
        variant: 1,
        originPlugin: 'Fallout4.esm',
        features: null,
      },
    ]);

    const features = await loadClipEffortFeatures(db(), modId);
    expect(
      features.get(voiceSynthesisStateKey('RaiderMale01', '000001', 1, 'fallout4.esm')),
    ).toEqual({ f0MedianSt: 25, brightnessDb: -2, voicedRatio: 0.9 });
    // Measured once and remembered as unmeasurable, so a resumed run skips it.
    expect(features.has(voiceSynthesisStateKey('RaiderMale01', '000002', 1, 'fallout4.esm'))).toBe(
      true,
    );
    const { rows } = await db().query<{
      line_key: string;
      strength: number | null;
      tag: string | null;
    }>(
      `SELECT line_key, strength, tag FROM voice_clip_effort WHERE mod_id = $1 ORDER BY line_key`,
      [modId],
    );
    expect(rows).toEqual([
      { line_key: '000001', strength: 2.7, tag: 'shouting' },
      { line_key: '000002', strength: null, tag: null },
    ]);
  });
});
