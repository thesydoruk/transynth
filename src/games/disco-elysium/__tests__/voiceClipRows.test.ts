import { describe, expect, it } from '@jest/globals';
import { discoVoiceFormidLower6 } from '../voice/discoverDiscoVoiceFiles';
import { voiceTranslationMapKey } from '../../../voice/loadVoiceTranslations';
import type { VoiceFileEntry } from '../../../voice/discoverVoiceFiles';
import { aggregateDiscoClipSpeakerCounts, buildDiscoVoiceClipRows } from '../voice/voiceClipRows';
import type { DiscoVoiceTextRef } from '../voice/voiceTextIndex';

const wav = (stem: string): VoiceFileEntry => ({
  relPath: `Audio/${stem}.wav`,
  absolutePath: `/pack/English_English_en/Audio/${stem}.wav`,
  fileName: `${stem}.wav`,
  lineKey: discoVoiceFormidLower6(stem),
  variant: 1,
  ext: 'wav',
});

describe('buildDiscoVoiceClipRows', () => {
  it('joins wav stems to record ids via Articy msgctxt keys', () => {
    const stem = 'Kim Kitsuragi-YARD  HANGED MAN-10';
    const ref: DiscoVoiceTextRef = {
      field: 'Dialogue Text',
      articyId: '0x0100000000000001',
      msgctxtKey: 'dialogue text/0x0100000000000001',
    };
    const rows = buildDiscoVoiceClipRows(
      [wav(stem)],
      new Map([[stem, ref]]),
      new Map([[ref.msgctxtKey, 42]]),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      wavStem: stem,
      speakerKey: 'Kim Kitsuragi',
      recordId: 42,
      msgctxtKey: ref.msgctxtKey,
      articyId: ref.articyId,
      field: 'Dialogue Text',
      relPath: `Audio/${stem}.wav`,
    });
    expect(rows[0]?.lineKey).toBe(discoVoiceFormidLower6(stem));
  });

  it('keeps orphan clips when the zip index has no lockit row', () => {
    const stem = 'Orphan-CONV-1';
    const rows = buildDiscoVoiceClipRows([wav(stem)], new Map(), new Map());
    expect(rows[0]?.recordId).toBeNull();
    expect(rows[0]?.speakerKey).toBe('Orphan');
  });
});

describe('aggregateDiscoClipSpeakerCounts', () => {
  it('counts lines, orphans, and dubbed audio per speaker', () => {
    const kim = discoVoiceFormidLower6('Kim-A-1');
    const you = discoVoiceFormidLower6('You-B-1');
    const counts = aggregateDiscoClipSpeakerCounts(
      [
        { speakerKey: 'Kim Kitsuragi', lineKey: kim, recordId: 1 },
        { speakerKey: 'Kim Kitsuragi', lineKey: 'DEAD', recordId: null },
        { speakerKey: 'You', lineKey: you, recordId: 2 },
      ],
      new Set([voiceTranslationMapKey(kim, 1)]),
    );

    expect(counts.get('Kim Kitsuragi')).toEqual({
      lineCount: 2,
      dubbedCount: 1,
      orphanCount: 1,
    });
    expect(counts.get('You')).toEqual({ lineCount: 1, dubbedCount: 0, orphanCount: 0 });
  });
});
