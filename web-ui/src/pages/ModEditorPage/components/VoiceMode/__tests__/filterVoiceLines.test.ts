import { describe, expect, it } from 'vitest';
import type { VoiceLinePreview } from '../../../../../api';
import {
  applyVoiceStatusMatch,
  needsTranslation,
  selectVisibleVoiceLines,
  voiceLineCounts,
} from '../filterVoiceLines';

const line = (
  partial: Partial<VoiceLinePreview> & Pick<VoiceLinePreview, 'stringId'>,
): VoiceLinePreview => ({
  formidLower6: '000001',
  infoFormidHex: '00000001',
  variant: 1,
  fileName: '00000001_1.fuz',
  speakerKey: 'MaleBoston',
  translationId: null,
  status: 'draft',
  source: 'Hello',
  translation: 'Привіт',
  isReference: false,
  isInheritedAudio: false,
  inheritedFrom: null,
  isOrphanAudio: false,
  hasTranslationAudio: true,
  canGenerateVoice: false,
  ttsSkipReason: null,
  ...partial,
});

describe('applyVoiceStatusMatch', () => {
  const lines = [line({ stringId: 10 }), line({ stringId: 20 }), line({ stringId: null })];

  it('keeps every line when no status filter is set', () => {
    expect(applyVoiceStatusMatch(lines, null)).toEqual(lines);
  });

  it('hides lines until matching ids load', () => {
    expect(applyVoiceStatusMatch(lines, undefined)).toEqual([]);
  });

  it('keeps only lines whose string id is in the translation-grid set', () => {
    expect(applyVoiceStatusMatch(lines, new Set([20])).map((item) => item.stringId)).toEqual([20]);
  });
});

describe('selectVisibleVoiceLines', () => {
  it('filters by missing translation and find text', () => {
    const lines = [
      line({ stringId: 1, translation: null, source: 'Alpha' }),
      line({ stringId: 2, translation: 'Так', source: 'Beta' }),
    ];
    expect(needsTranslation(lines[0]!)).toBe(true);
    expect(selectVisibleVoiceLines(lines, 'needsTranslation', 'alp')).toHaveLength(1);
    expect(voiceLineCounts(lines).needsTranslation).toBe(1);
  });
});
