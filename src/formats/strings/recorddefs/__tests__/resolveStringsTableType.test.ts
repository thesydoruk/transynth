import { describe, it, expect } from '@jest/globals';
import { resolveStringsTableTypeForRow } from '../resolveStringsTableType';
import { fallout4, fallout76 } from '../../../../games/creation-engine/titles/fallout';

describe('record definitions (fo4)', () => {
  const { recorddefs } = fallout4;

  it('maps INFO/NAM1 to ILSTRINGS per xTranslator', () => {
    expect(recorddefs.tableFor('INFO', 'NAM1')).toBe('ILSTRINGS');
  });

  it('maps INFO/RNAM to STRINGS per xTranslator', () => {
    expect(recorddefs.tableFor('INFO', 'RNAM')).toBe('STRINGS');
  });

  it('maps INNR/WNAM to STRINGS', () => {
    expect(recorddefs.tableFor('INNR', 'WNAM')).toBe('STRINGS');
    expect(resolveStringsTableTypeForRow(recorddefs, 'INNR', 'INNR\\WNAM[2]')).toBe('STRINGS');
  });

  it('maps generic DESC to DLSTRINGS via fallback', () => {
    expect(recorddefs.tableFor('WEAP', 'DESC')).toBe('DLSTRINGS');
  });

  it('maps QUST/CNAM to DLSTRINGS explicitly', () => {
    expect(recorddefs.tableFor('QUST', 'CNAM')).toBe('DLSTRINGS');
  });

  it('maps LSCR/DESC to STRINGS explicitly (overrides fallback)', () => {
    expect(recorddefs.tableFor('LSCR', 'DESC')).toBe('STRINGS');
  });

  it('resolves from row path', () => {
    expect(resolveStringsTableTypeForRow(recorddefs, 'INFO', 'NAM1')).toBe('ILSTRINGS');
    expect(resolveStringsTableTypeForRow(recorddefs, 'BOOK', 'INFO\\DESC')).toBe('DLSTRINGS');
  });
});

describe('record definitions (fo76)', () => {
  it('inherits fo4 rules and adds fo76-specific fields', () => {
    expect(fallout76.recorddefs.tableFor('INFO', 'NAM1')).toBe('ILSTRINGS');
    expect(fallout76.recorddefs.tableFor('QUST', 'NAM1')).toBe('STRINGS');
  });
});
