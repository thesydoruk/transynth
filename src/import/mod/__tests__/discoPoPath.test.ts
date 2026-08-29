import { describe, expect, it } from '@jest/globals';
import {
  DISCO_PO_PATH_MAX_BYTES,
  discoDialogueMsgctxtKey,
  discoPoEntryStorageKey,
  discoPoRecordPath,
  hashDiscoMsgid,
  isHashedDiscoEntryKey,
  parseDiscoDialogueMsgctxt,
  parseDiscoPoPathForSignature,
} from '../discoPoPath';

describe('discoPoPath', () => {
  it('keeps short msgids verbatim', () => {
    const key = discoPoEntryStorageKey('Dialogues.po', 'DialogueText/0x1', 'Hello');
    expect(key).toBe('DialogueText/0x1::Hello');
    expect(isHashedDiscoEntryKey(key)).toBe(false);
  });

  it('hashes msgids that would exceed the btree-safe path budget', () => {
    const msgid = '9'.repeat(4000);
    const key = discoPoEntryStorageKey(
      'DialoguesLockitEnglish.po',
      'DialogueText/0x01000070000037BF',
      msgid,
    );
    expect(isHashedDiscoEntryKey(key)).toBe(true);
    expect(key).toBe(`DialogueText/0x01000070000037BF::#${hashDiscoMsgid(msgid)}`);
    const path = discoPoRecordPath(
      'DialoguesLockitEnglish.po',
      'DialogueText/0x01000070000037BF',
      msgid,
    );
    expect(Buffer.byteLength(path, 'utf8')).toBeLessThanOrEqual(DISCO_PO_PATH_MAX_BYTES);
  });

  it('parses spoken Dialogue Text / Alternate msgctxt', () => {
    expect(parseDiscoDialogueMsgctxt('Dialogue Text/0x01000058000060E5')).toEqual({
      field: 'Dialogue Text',
      articyId: '0x01000058000060e5',
      alternateIndex: null,
    });
    expect(parseDiscoDialogueMsgctxt('Alternate2/0x0100002B00060B58')).toEqual({
      field: 'Alternate2',
      articyId: '0x0100002b00060b58',
      alternateIndex: 2,
    });
    expect(parseDiscoDialogueMsgctxt('Dialogue Text/0x1_EFFECT')).toBeNull();
    expect(discoDialogueMsgctxtKey('Dialogue Text', '0xABC')).toBe('dialogue text/0xabc');
  });

  it('extracts relPo and msgctxt from PO record paths', () => {
    expect(parseDiscoPoPathForSignature('PO\\Dialogues.po\\Kim Kitsuragi-YARD-1::Hello')).toEqual({
      relPo: 'Dialogues.po',
      msgctxt: 'Kim Kitsuragi-YARD-1',
    });
  });
});
