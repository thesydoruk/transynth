import { describe, expect, it } from '@jest/globals';
import type { VoiceFileEntry } from '../discoverVoiceFiles';
import { voiceTranslationMapKey } from '../voiceTextRows';
import { buildVoiceClipRows, padVoiceFormidHex, type VoiceClipStringRef } from '../voiceClipRows';

const file = (speaker: string, formid: string, variant: number): VoiceFileEntry => ({
  relPath: `Sound/Voice/Fallout4.esm/${speaker}/${formid}_${variant}.fuz`,
  absolutePath: `/data/${speaker}/${formid}_${variant}.fuz`,
  fileName: `${formid}_${variant}.fuz`,
  lineKey: formid.substring(2).toUpperCase(),
  variant,
  ext: 'fuz',
  originPlugin: 'fallout4.esm',
});

const voiceRootRel = 'Sound/Voice/Fallout4.esm';
const ORIGIN = 'fallout4.esm';

describe('padVoiceFormidHex', () => {
  it('pads lower-6 FormIDs to 8 hex digits', () => {
    expect(padVoiceFormidHex('005825')).toBe('00005825');
  });
});

describe('buildVoiceClipRows', () => {
  it('keeps Nate and Nora takes of the same INFO as separate rows', () => {
    const key = voiceTranslationMapKey('005825', 1, ORIGIN);
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
    const sourceKey = voiceTranslationMapKey('1AC372', 1, ORIGIN);
    const rows = buildVoiceClipRows(
      [file('PlayerVoiceMale01', '0022B5CD', 1)],
      voiceRootRel,
      new Map([[sourceKey, { stringId: 77, formidHex: '001AC372' }]]),
      new Map([[`${ORIGIN}/22B5CD`, `${ORIGIN}/1AC372`]]),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      speakerKey: 'PlayerVoiceMale01',
      lineKey: '22B5CD',
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
      [voiceTranslationMapKey('1505FB', 1, ORIGIN), { stringId: 1, formidHex: '001505FB' }],
      [voiceTranslationMapKey('1505FB', 102, ORIGIN), { stringId: 2, formidHex: '001505FB' }],
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

  it('records the origin plugin on each row', () => {
    const rows = buildVoiceClipRows(
      [file('MaleBoston', '00ABCDEF', 1)],
      voiceRootRel,
      new Map(),
      new Map(),
    );
    expect(rows[0]?.originPlugin).toBe('fallout4.esm');
  });

  it('falls back to the origin folder of the path when the entry has none', () => {
    const entry = { ...file('MaleBoston', '00ABCDEF', 1) };
    delete entry.originPlugin;
    const rows = buildVoiceClipRows([entry], voiceRootRel, new Map(), new Map());
    expect(rows[0]?.originPlugin).toBe('fallout4.esm');
  });

  it('does not match a string of another origin with the same FormID', () => {
    const strings = new Map<string, VoiceClipStringRef>([
      [voiceTranslationMapKey('005825', 1, 'dlcrobot.esm'), { stringId: 5, formidHex: '00005825' }],
    ]);
    const rows = buildVoiceClipRows(
      [file('MaleRough', '00005825', 1)],
      voiceRootRel,
      strings,
      new Map(),
    );
    expect(rows[0]?.stringId).toBeNull();
  });

  it('keeps takes of the same speaker and FormID under two origins as separate rows', () => {
    const patch: VoiceFileEntry = {
      ...file('MaleRough', '00005825', 1),
      relPath: 'Sound/Voice/Patch.esp/MaleRough/00005825_1.fuz',
      originPlugin: 'patch.esp',
    };
    const strings = new Map<string, VoiceClipStringRef>([
      [voiceTranslationMapKey('005825', 1, 'patch.esp'), { stringId: 9, formidHex: '00005825' }],
      [voiceTranslationMapKey('005825', 1, ORIGIN), { stringId: 8, formidHex: '00005825' }],
    ]);
    const rows = buildVoiceClipRows(
      [file('MaleRough', '00005825', 1), patch],
      voiceRootRel,
      strings,
      new Map(),
    );
    expect(rows.map((r) => [r.originPlugin, r.stringId])).toEqual([
      ['fallout4.esm', 8],
      ['patch.esp', 9],
    ]);
  });

  it('resolves a DNAM alias across the same origin only', () => {
    const strings = new Map<string, VoiceClipStringRef>([
      [voiceTranslationMapKey('1AC372', 1, 'dlcrobot.esm'), { stringId: 1, formidHex: '001AC372' }],
    ]);
    const rows = buildVoiceClipRows(
      [file('PlayerVoiceMale01', '0022B5CD', 1)],
      voiceRootRel,
      strings,
      new Map([[`${ORIGIN}/22B5CD`, `${ORIGIN}/1AC372`]]),
    );
    expect(rows[0]).toMatchObject({ stringId: null, sharedFromFormid: '1AC372' });
  });
});
