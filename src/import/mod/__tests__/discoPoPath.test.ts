import { describe, expect, it } from '@jest/globals';
import {
  DISCO_PO_PATH_MAX_BYTES,
  discoPoEntryStorageKey,
  discoPoRecordPath,
  hashDiscoMsgid,
  isHashedDiscoEntryKey,
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
});
