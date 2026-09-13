import { describe, expect, it } from '@jest/globals';
import type { VoiceFileEntry } from '../discoverVoiceFiles';
import { voiceTranslationMapKey } from '../voiceTextRows';
import { buildVoiceClipRows, padVoiceFormidHex, type VoiceClipStringRef } from '../voiceClipRows';

const file = (speaker: string, formid: string, variant: number): VoiceFileEntry => ({
  relPath: `Sound/Voice/Fallout4.esm/${speaker}/${formid}_${variant}.fuz`,
  absolutePath: `/data/${speaker}/${formid}_${variant}.fuz`,
  fileName: `${formid}_${variant}.fuz`,
  formidLower6: formid.substring(2).toUpperCase(),
  variant,
  ext: 'fuz',
});

const voiceRootRel = 'Sound/Voice/Fallout4.esm';

describe('padVoiceFormidHex', () => {
  it('pads lower-6 FormIDs to 8 hex digits', () => {
    expect(padVoiceFormidHex('005825')).toBe('00005825');
  });
});

describe('buildVoiceClipRows', () => {
  it('keeps Nate and Nora takes of the same INFO as separate rows', () => {
    const key = voiceTranslationMapKey('005825', 1);
    const strings = new Map<string, VoiceClipStringRef>([
      [key, { stringId: 10, formidHex: '00005825' }],
    ]);

    const rows = buildVoiceClipRows(
      [file('PlayerVoiceMale01', '00005825', 1), file('PlayerVoiceFemale01', '00005825', 1)],
      voiceRootRel,
      strings,
      new Map(),
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.speakerKey).sort()).toEqual([
      'PlayerVoiceFemale01',
      'PlayerVoiceMale01',
    ]);
    expect(rows.every((row) => row.stringId === 10 && row.variant === 1)).toBe(true);
  });

  it('links a DNAM alias take to the borrowed string and records shared_from', () => {
    const sourceKey = voiceTranslationMapKey('1AC372', 1);
    const rows = buildVoiceClipRows(
      [file('PlayerVoiceMale01', '0022B5CD', 1)],
      voiceRootRel,
      new Map([[sourceKey, { stringId: 77, formidHex: '001AC372' }]]),
      new Map([['22B5CD', '1AC372']]),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      speakerKey: 'PlayerVoiceMale01',
      formidLower6: '22B5CD',
      formidHex: '0022B5CD',
      variant: 1,
      stringId: 77,
      sharedFromFormid: '1AC372',
    });
  });

  it('keeps orphan files when no INFO string matches', () => {
    const rows = buildVoiceClipRows(
      [file('MaleBoston', '00ABCDEF', 1)],
      voiceRootRel,
      new Map(),
      new Map(),
    );

    expect(rows[0]).toMatchObject({
      speakerKey: 'MaleBoston',
      stringId: null,
      sharedFromFormid: null,
      variant: 1,
    });
  });

  it('stores one row per response number on the same speaker', () => {
    const strings = new Map<string, VoiceClipStringRef>([
      [voiceTranslationMapKey('1505FB', 1), { stringId: 1, formidHex: '001505FB' }],
      [voiceTranslationMapKey('1505FB', 102), { stringId: 2, formidHex: '001505FB' }],
    ]);

    const rows = buildVoiceClipRows(
      [file('FemaleEvenToned', '001505FB', 1), file('FemaleEvenToned', '001505FB', 102)],
      voiceRootRel,
      strings,
      new Map(),
    );

    expect(rows.map((row) => ({ variant: row.variant, stringId: row.stringId }))).toEqual([
      { variant: 1, stringId: 1 },
      { variant: 102, stringId: 2 },
    ]);
  });
});
