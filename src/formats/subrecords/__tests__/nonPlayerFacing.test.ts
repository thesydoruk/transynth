import { describe, it, expect } from '@jest/globals';
import { isTranslatableSubrecord, isIgnoredRecord } from '../knownStrings';
import { isNonPlayerFacingRecord } from '../nonPlayerFacing';

describe('non-player-facing records', () => {
  it('identifies INNR and ARMA', () => {
    expect(isNonPlayerFacingRecord('INNR')).toBe(true);
    expect(isNonPlayerFacingRecord('ARMA')).toBe(true);
    expect(isNonPlayerFacingRecord('WEAP')).toBe(false);
  });

  it('does not extract excluded Fallout 4 record types', () => {
    for (const sig of ['ARMA', 'PACK', 'SCEN'] as const) {
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

  it('extracts KYWD FULL — workshop menu categories and armor slot names', () => {
    for (const game of ['fo4', 'fo76'] as const) {
      expect(isIgnoredRecord('KYWD', game)).toBe(false);
      expect(isTranslatableSubrecord('KYWD', 'FULL', game)).toBe(true);
    }
    expect(isNonPlayerFacingRecord('KYWD')).toBe(false);
  });

  it('extracts LVLI ONAM — unique item name overrides', () => {
    for (const game of ['fo4', 'fo76'] as const) {
      expect(isIgnoredRecord('LVLI', game)).toBe(false);
      expect(isTranslatableSubrecord('LVLI', 'ONAM', game)).toBe(true);
      expect(isTranslatableSubrecord('LVLI', 'FULL', game)).toBe(false);
    }
    expect(isNonPlayerFacingRecord('LVLI')).toBe(false);
  });

  it('ignores INGR YNAM — pickup sound FormID, not text', () => {
    for (const game of ['fo4', 'fo76'] as const) {
      expect(isTranslatableSubrecord('INGR', 'YNAM', game)).toBe(false);
      expect(isTranslatableSubrecord('INGR', 'FULL', game)).toBe(true);
    }
  });
});
