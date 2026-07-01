import { describe, it, expect } from '@jest/globals';
import { isTranslatableSubrecord, isIgnoredRecord } from '../knownStrings';
import { isNonPlayerFacingRecord } from '../nonPlayerFacing';

describe('non-player-facing records', () => {
  it('identifies REFR, KYWD, INNR, LVLI, ARMA', () => {
    expect(isNonPlayerFacingRecord('REFR')).toBe(true);
    expect(isNonPlayerFacingRecord('KYWD')).toBe(true);
    expect(isNonPlayerFacingRecord('WEAP')).toBe(false);
  });

  it('does not extract excluded Fallout 4 record types', () => {
    for (const sig of ['REFR', 'KYWD', 'INNR', 'LVLI', 'ARMA'] as const) {
      expect(isIgnoredRecord(sig, 'fo4')).toBe(true);
      expect(isTranslatableSubrecord(sig, 'FULL', 'fo4')).toBe(false);
    }
  });

  it('still extracts player-facing Fallout 4 records', () => {
    expect(isTranslatableSubrecord('WEAP', 'FULL', 'fo4')).toBe(true);
    expect(isTranslatableSubrecord('INFO', 'NAM1', 'fo4')).toBe(true);
    expect(isTranslatableSubrecord('DIAL', 'FULL', 'fo4')).toBe(true);
    expect(isTranslatableSubrecord('GMST', 'DATA', 'fo4')).toBe(true);
  });

  it('does not extract REFR for Skyrim', () => {
    expect(isTranslatableSubrecord('REFR', 'FULL', 'sse')).toBe(false);
    expect(isTranslatableSubrecord('WEAP', 'FULL', 'sse')).toBe(true);
  });
});
