import { describe, it, expect } from '@jest/globals';
import { resolveStringsTableType, resolveStringsTableTypeForRow } from '../resolveStringsTableType';

describe('resolveStringsTableType (fo4)', () => {
  const game = 'fo4' as const;

  it('maps INFO/NAM1 to ILSTRINGS per xTranslator', () => {
    expect(resolveStringsTableType(game, 'INFO', 'NAM1')).toBe('ILSTRINGS');
  });

  it('maps INFO/RNAM to STRINGS per xTranslator', () => {
    expect(resolveStringsTableType(game, 'INFO', 'RNAM')).toBe('STRINGS');
  });

  it('maps INNR/WNAM to STRINGS', () => {
    expect(resolveStringsTableType(game, 'INNR', 'WNAM')).toBe('STRINGS');
    expect(resolveStringsTableTypeForRow(game, 'INNR', 'INNR\\WNAM[2]')).toBe('STRINGS');
  });

  it('maps generic DESC to DLSTRINGS via fallback', () => {
    expect(resolveStringsTableType(game, 'WEAP', 'DESC')).toBe('DLSTRINGS');
  });

  it('maps QUST/CNAM to DLSTRINGS explicitly', () => {
    expect(resolveStringsTableType(game, 'QUST', 'CNAM')).toBe('DLSTRINGS');
  });

  it('maps LSCR/DESC to STRINGS explicitly (overrides fallback)', () => {
    expect(resolveStringsTableType(game, 'LSCR', 'DESC')).toBe('STRINGS');
  });

  it('resolves from row path', () => {
    expect(resolveStringsTableTypeForRow(game, 'INFO', 'NAM1')).toBe('ILSTRINGS');
    expect(resolveStringsTableTypeForRow(game, 'BOOK', 'INFO\\DESC')).toBe('DLSTRINGS');
  });
});

describe('resolveStringsTableType (fo76)', () => {
  it('inherits fo4 rules and adds fo76-specific fields', () => {
    expect(resolveStringsTableType('fo76', 'INFO', 'NAM1')).toBe('ILSTRINGS');
    expect(resolveStringsTableType('fo76', 'QUST', 'NAM1')).toBe('STRINGS');
  });
});
