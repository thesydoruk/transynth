import { describe, it, expect } from '@jest/globals';
import { isTranslatableSubrecord, isIgnoredRecord } from '../knownStrings';
import { isNonPlayerFacingRecord } from '../nonPlayerFacing';

describe('non-player-facing records', () => {
  it('identifies KYWD, INNR, LVLI, ARMA', () => {
    expect(isNonPlayerFacingRecord('KYWD')).toBe(true);
    expect(isNonPlayerFacingRecord('ARMA')).toBe(true);
    expect(isNonPlayerFacingRecord('WEAP')).toBe(false);
  });

  it('does not extract excluded Fallout 4 record types', () => {
    for (const sig of ['KYWD', 'LVLI', 'ARMA'] as const) {
      expect(isIgnoredRecord(sig, 'fo4')).toBe(true);
      expect(isTranslatableSubrecord(sig, 'FULL', 'fo4')).toBe(false);
    }
  });

  it('extracts INNR WNAM while keeping INNR non-player-facing for skip-detect', () => {
    expect(isIgnoredRecord('INNR', 'fo4')).toBe(false);
    expect(isTranslatableSubrecord('INNR', 'WNAM', 'fo4')).toBe(true);
    expect(isNonPlayerFacingRecord('INNR')).toBe(true);
  });

  it('still extracts player-facing Fallout 4 records', () => {
    expect(isTranslatableSubrecord('WEAP', 'FULL', 'fo4')).toBe(true);
    expect(isTranslatableSubrecord('INFO', 'NAM1', 'fo4')).toBe(true);
    expect(isTranslatableSubrecord('DIAL', 'FULL', 'fo4')).toBe(true);
    expect(isTranslatableSubrecord('GMST', 'DATA', 'fo4')).toBe(true);
  });

  it('extracts REFR FULL — map marker labels are player-facing', () => {
    for (const game of ['fo4', 'fo76', 'sse', 'sle', 'fnv', 'fo3', 'ob'] as const) {
      expect(isIgnoredRecord('REFR', game)).toBe(false);
      expect(isTranslatableSubrecord('REFR', 'FULL', game)).toBe(true);
    }
    expect(isNonPlayerFacingRecord('REFR')).toBe(false);
  });
});
