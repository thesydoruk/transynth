import { describe, expect, it } from '@jest/globals';
import {
  referenceVoiceFileExt,
  referenceVoiceTakeMapKey,
  shouldReplaceReferenceVoiceTake,
} from '../referenceVoiceTakes';
import { referenceTakeFitsLine } from '../reuseReferenceVoiceTakes';

describe('shouldReplaceReferenceVoiceTake', () => {
  it('takes any take when the store holds none', () => {
    expect(shouldReplaceReferenceVoiceTake(null, 0.2)).toBe(true);
    expect(shouldReplaceReferenceVoiceTake(null, null)).toBe(true);
    expect(shouldReplaceReferenceVoiceTake(undefined, undefined)).toBe(true);
  });

  it('replaces only with a strictly higher score', () => {
    expect(shouldReplaceReferenceVoiceTake({ voiceSimilarity: 0.4 }, 0.41)).toBe(true);
    expect(shouldReplaceReferenceVoiceTake({ voiceSimilarity: 0.4 }, 0.4)).toBe(false);
    expect(shouldReplaceReferenceVoiceTake({ voiceSimilarity: 0.4 }, 0.39)).toBe(false);
  });

  it('replaces an unscored take with a scored one', () => {
    expect(shouldReplaceReferenceVoiceTake({ voiceSimilarity: null }, 0.1)).toBe(true);
  });

  it('keeps the stored take when the new one has no score', () => {
    expect(shouldReplaceReferenceVoiceTake({ voiceSimilarity: 0.4 }, null)).toBe(false);
    expect(shouldReplaceReferenceVoiceTake({ voiceSimilarity: null }, null)).toBe(false);
    expect(shouldReplaceReferenceVoiceTake({ voiceSimilarity: null }, undefined)).toBe(false);
  });
});

describe('reference voice keys', () => {
  it('reads the extension of a take lower-cased, with its dot', () => {
    expect(referenceVoiceFileExt('Sound/Voice/Mod.esp/MaleBoston/00011111_1.FUZ')).toBe('.fuz');
    expect(referenceVoiceFileExt('content/content0/enpc/1185686.wav')).toBe('.wav');
    expect(referenceVoiceFileExt('no-extension')).toBe('');
  });

  it('keys a take by source digest and payload version, case-insensitively', () => {
    expect(referenceVoiceTakeMapKey('ABCDEF', 'V1')).toBe(referenceVoiceTakeMapKey('abcdef', 'v1'));
    expect(referenceVoiceTakeMapKey('abcdef', 'v1')).not.toBe(
      referenceVoiceTakeMapKey('abcdef', 'v2'),
    );
  });
});

describe('referenceTakeFitsLine', () => {
  it('accepts a stored take of the kind the line expects', () => {
    expect(
      referenceTakeFitsLine({ fileExt: '.fuz' }, 'Sound/Voice/Mod.esp/Npc/00011111_1.fuz'),
    ).toBe(true);
    expect(
      referenceTakeFitsLine({ fileExt: '.fuz' }, 'Sound/Voice/Mod.esp/Npc/00011111_1.FUZ'),
    ).toBe(true);
  });

  it('rejects another kind of file, and a missing take', () => {
    expect(
      referenceTakeFitsLine({ fileExt: '.wav' }, 'Sound/Voice/Mod.esp/Npc/00011111_1.fuz'),
    ).toBe(false);
    expect(referenceTakeFitsLine(undefined, 'Sound/Voice/Mod.esp/Npc/00011111_1.fuz')).toBe(false);
  });
});
