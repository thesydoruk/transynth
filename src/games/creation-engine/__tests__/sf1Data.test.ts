import { describe, it, expect } from '@jest/globals';
import { compileSubrecordConfig, type GameSubrecordsConfig } from '../../../formats/subrecords';
import { compileRecorddefs, type RecorddefsJson } from '../../../formats/strings/recorddefs';
import sf1Subrecords from '../data/subrecords/sf1.json' with { type: 'json' };
import sf1Recorddefs from '../data/recorddefs/sf1.json' with { type: 'json' };
import sf1FunctionKeywords from '../data/function-keywords/sf1.json' with { type: 'json' };

const subrecords = compileSubrecordConfig(sf1Subrecords as GameSubrecordsConfig);
const recorddefs = compileRecorddefs([sf1Recorddefs as RecorddefsJson]);

describe('Starfield (sf1) subrecord data', () => {
  it('reads dialogue response text and prompt', () => {
    expect(subrecords.isTranslatable('INFO', 'NAM1')).toBe(true);
    expect(subrecords.isTranslatable('INFO', 'RNAM')).toBe(true);
    expect(subrecords.isTranslatable('INFO', 'NAM2')).toBe(false);
  });

  it('reads names and descriptions', () => {
    expect(subrecords.isTranslatable('WEAP', 'FULL')).toBe(true);
    expect(subrecords.isTranslatable('WEAP', 'DESC')).toBe(true);
    expect(subrecords.isTranslatable('NPC_', 'SHRT')).toBe(true);
    expect(subrecords.isTranslatable('QUST', 'QMDT')).toBe(true);
  });

  it('reads terminal menus, which are TMLM records, not TERM', () => {
    for (const field of ['BTXT', 'INAM', 'ITXT', 'ISTX', 'UNAM']) {
      expect(subrecords.isTranslatable('TMLM', field)).toBe(true);
    }
    expect(subrecords.isTranslatable('TERM', 'BTXT')).toBe(false);
  });

  it('does not read fields that are ints or formids in another record', () => {
    expect(subrecords.isTranslatable('PERK', 'EPFD')).toBe(false);
    expect(subrecords.isTranslatable('WEAP', 'NAM1')).toBe(false);
  });

  it('skips placed references and records without text', () => {
    expect(subrecords.isIgnoredRecord('ACHR')).toBe(true);
    expect(subrecords.isIgnoredRecord('SCEN')).toBe(true);
    expect(subrecords.isTranslatable('ACHR', 'FULL')).toBe(false);
  });

  it('keeps the spaceship hull code to its generic base form', () => {
    expect(subrecords.isTranslatable('GBFM', 'HULL')).toBe(true);
    expect(subrecords.isTranslatable('WEAP', 'HULL')).toBe(false);
  });
});

describe('Starfield (sf1) record definitions', () => {
  it('routes response text to ILSTRINGS and other dialogue text to STRINGS', () => {
    expect(recorddefs.tableFor('INFO', 'NAM1')).toBe('ILSTRINGS');
    expect(recorddefs.tableFor('INFO', 'RNAM')).toBe('STRINGS');
  });

  it('routes names to STRINGS and descriptions to DLSTRINGS', () => {
    expect(recorddefs.tableFor('WEAP', 'FULL')).toBe('STRINGS');
    expect(recorddefs.tableFor('WEAP', 'DESC')).toBe('DLSTRINGS');
    expect(recorddefs.tableFor('LSCR', 'DESC')).toBe('STRINGS');
  });

  it('routes long logs and book text to DLSTRINGS, terminal menu text to STRINGS', () => {
    expect(recorddefs.tableFor('QUST', 'CNAM')).toBe('DLSTRINGS');
    expect(recorddefs.tableFor('BOOK', 'CNAM')).toBe('DLSTRINGS');
    expect(recorddefs.tableFor('TMLM', 'BTXT')).toBe('STRINGS');
    expect(recorddefs.tableFor('TMLM', 'ITXT')).toBe('STRINGS');
  });

  it('only pins pairs the subrecord config actually reads', () => {
    const missing = (sf1Recorddefs.explicit as Array<[string, string, string]>).filter(
      ([record, field]) => !subrecords.isTranslatable(record, field),
    );
    expect(missing).toEqual([]);
  });

  it('has no function keywords without a Starfield source for them', () => {
    expect(sf1FunctionKeywords).toEqual([]);
  });
});
