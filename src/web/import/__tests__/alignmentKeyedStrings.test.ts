import { alignmentKeyedStrings, type ImportStringRow } from '../modImport';

describe('alignmentKeyedStrings', () => {
  it('keys lstring-backed strings by their lstring id (stable across locales)', () => {
    const rows: ImportStringRow[] = [
      { id: 10, record_id: 1, lstring_id: 100, text_raw: 'Name' },
      { id: 11, record_id: 1, lstring_id: 200, text_raw: 'Desc' },
    ];
    expect(alignmentKeyedStrings(rows).map((e) => e.key)).toEqual(['1:L100', '1:L200']);
  });

  it('gives each inline string on the same record a distinct positional key', () => {
    // RACE/TTGP-style record: many inline preset names sharing one record_id.
    const rows: ImportStringRow[] = [
      { id: 1, record_id: 7, lstring_id: null, text_raw: 'SkinTints' },
      { id: 2, record_id: 7, lstring_id: null, text_raw: 'Brows' },
      { id: 3, record_id: 7, lstring_id: null, text_raw: 'Scars' },
    ];
    const keys = alignmentKeyedStrings(rows).map((e) => e.key);
    expect(keys).toEqual(['7:P0', '7:P1', '7:P2']);
    expect(new Set(keys).size).toBe(3); // no collapse
  });

  it('aligns the same logical inline string across two locales by position', () => {
    const en: ImportStringRow[] = [
      { id: 1, record_id: 7, lstring_id: null, text_raw: 'Brows' },
      { id: 2, record_id: 7, lstring_id: null, text_raw: 'Scars' },
    ];
    const uk: ImportStringRow[] = [
      { id: 50, record_id: 7, lstring_id: null, text_raw: 'Брови' },
      { id: 51, record_id: 7, lstring_id: null, text_raw: 'Шрами' },
    ];
    const enByKey = new Map(alignmentKeyedStrings(en).map((e) => [e.key, e.row]));
    const pairs = alignmentKeyedStrings(uk).map((e) => ({
      src: enByKey.get(e.key)?.text_raw,
      tgt: e.row.text_raw,
    }));
    expect(pairs).toEqual([
      { src: 'Brows', tgt: 'Брови' },
      { src: 'Scars', tgt: 'Шрами' },
    ]);
  });

  it('counts inline ordinals independently per record', () => {
    const rows: ImportStringRow[] = [
      { id: 1, record_id: 1, lstring_id: null, text_raw: 'a' },
      { id: 2, record_id: 2, lstring_id: null, text_raw: 'b' },
      { id: 3, record_id: 1, lstring_id: null, text_raw: 'c' },
    ];
    expect(alignmentKeyedStrings(rows).map((e) => e.key)).toEqual(['1:P0', '2:P0', '1:P1']);
  });
});
