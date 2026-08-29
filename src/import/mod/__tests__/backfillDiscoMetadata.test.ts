import { describe, expect, it } from '@jest/globals';
import { parseDiscoPoPathForSignature } from '../backfillDiscoMetadata';

describe('parseDiscoPoPathForSignature', () => {
  it('extracts relPo and msgctxt from PO paths', () => {
    expect(parseDiscoPoPathForSignature('PO\\Dialogues.po\\Kim Kitsuragi-YARD-1::Hello')).toEqual({
      relPo: 'Dialogues.po',
      msgctxt: 'Kim Kitsuragi-YARD-1',
    });
    expect(
      parseDiscoPoPathForSignature(
        'PO\\DialoguesEffectsLockitEnglish.po\\Dialogue Text/0x1_EFFECT::N/A',
      ),
    ).toEqual({
      relPo: 'DialoguesEffectsLockitEnglish.po',
      msgctxt: 'Dialogue Text/0x1_EFFECT',
    });
  });

  it('returns null for non-PO paths', () => {
    expect(parseDiscoPoPathForSignature('INFO\\NAM1')).toBeNull();
  });
});
