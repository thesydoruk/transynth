import { describe, expect, it } from '@jest/globals';
import { insertMod, useTestDb } from '../../testing/testDb';
import {
  deleteVoiceSynthesisStamp,
  loadVoiceSynthesisStampMap,
  upsertVoiceSynthesisState,
  voiceSynthesisStateKey,
  type VoiceSynthesisStateRow,
} from '../voiceSynthesisState';

const stamp = (over: Partial<VoiceSynthesisStateRow>): VoiceSynthesisStateRow => ({
  modId: 0,
  lineKey: '825D9B',
  variant: 1,
  targetLang: 'uk',
  speakerKey: 'PlayerVoiceFemale01',
  originPlugin: 'fallout4.esm',
  ttsTextVersion: 'v1',
  voiceSimilarity: 0.5,
  ...over,
});

describe('deleteVoiceSynthesisStamp', () => {
  const db = useTestDb();

  it("forgets one speaker's stamp in one language and leaves every other", async () => {
    const modId = await insertMod(db());
    const nora = stamp({ modId });
    await upsertVoiceSynthesisState(db(), nora);
    await upsertVoiceSynthesisState(db(), stamp({ modId, speakerKey: 'PlayerVoiceMale01' }));
    await upsertVoiceSynthesisState(db(), stamp({ modId, targetLang: 'de' }));
    await upsertVoiceSynthesisState(db(), stamp({ modId, variant: 2 }));
    await upsertVoiceSynthesisState(db(), stamp({ modId, originPlugin: 'dlccoast.esm' }));
    // Rows older code wrote: the shared no-speaker one stays, Nora's origin-less one goes.
    await upsertVoiceSynthesisState(db(), stamp({ modId, speakerKey: '', originPlugin: '' }));
    await db().query(
      `INSERT INTO voice_synthesis_state
         (mod_id, line_key, variant, target_lang, speaker_key, origin_plugin, tts_text_version)
       VALUES ($1, '825D9B', 1, 'uk', 'PlayerVoiceFemale01', '', 'old')`,
      [modId],
    );

    const removed = await deleteVoiceSynthesisStamp(db(), {
      ...nora,
      lineKey: '825d9b',
      targetLang: 'UK',
      originPlugin: 'Fallout4.esm',
    });

    expect(removed).toBe(2);
    const uk = await loadVoiceSynthesisStampMap(db(), modId, 'uk');
    expect([...uk.keys()].sort()).toEqual(
      [
        voiceSynthesisStateKey('PlayerVoiceMale01', '825D9B', 1, 'fallout4.esm'),
        voiceSynthesisStateKey('PlayerVoiceFemale01', '825D9B', 2, 'fallout4.esm'),
        voiceSynthesisStateKey('PlayerVoiceFemale01', '825D9B', 1, 'dlccoast.esm'),
        voiceSynthesisStateKey('', '825D9B', 1),
      ].sort(),
    );
    expect((await loadVoiceSynthesisStampMap(db(), modId, 'de')).size).toBe(1);
    expect(await deleteVoiceSynthesisStamp(db(), nora)).toBe(0);
  });
});
