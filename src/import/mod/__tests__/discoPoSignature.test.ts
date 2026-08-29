import { describe, expect, it } from '@jest/globals';
import { classifyDiscoPoSignature, discoSpokenSignatureSqlValues } from '../discoPoSignature';

describe('classifyDiscoPoSignature', () => {
  it('marks effect msgctxt as FX even inside DialoguesEffects files', () => {
    expect(
      classifyDiscoPoSignature(
        'DialoguesEffectsLockitEnglish.po',
        'Dialogue Text/0x01000058000060E5_EFFECT',
      ),
    ).toBe('FX');
  });

  it('marks spoken dialogue lines as DLG', () => {
    expect(classifyDiscoPoSignature('Dialogues.po', 'Kim Kitsuragi-YARD-1')).toBe('DLG');
    expect(
      classifyDiscoPoSignature('DialoguesEffectsLockitEnglish.po', 'Kim Kitsuragi-YARD-1'),
    ).toBe('DLG');
  });

  it('marks General lockit as GEN', () => {
    expect(classifyDiscoPoSignature('General.po', 'UI_BUTTON_OK')).toBe('GEN');
    expect(classifyDiscoPoSignature('GeneralLockitEnglish.po', 'Thought Cabinet')).toBe('GEN');
  });

  it('falls back to PO for unknown packs', () => {
    expect(classifyDiscoPoSignature('Misc.po', 'plain')).toBe('PO');
  });

  it('limits spoken wav joins to DLG and legacy PO', () => {
    expect(discoSpokenSignatureSqlValues()).toEqual(['DLG', 'PO']);
  });
});
