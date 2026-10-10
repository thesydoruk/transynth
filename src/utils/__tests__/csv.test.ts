import { describe, it, expect } from '@jest/globals';
import { iterCsvRows, csvRow } from '../csv';

/** Every record of a CSV text, each as its field values. */
const rows = (text: string): string[][] => [...iterCsvRows(text)];

describe('iterCsvRows', () => {
  it('parses simple unquoted fields', () => {
    expect(rows('a,b,c')).toEqual([['a', 'b', 'c']]);
  });

  it('parses quoted fields', () => {
    expect(rows('"hello","world"')).toEqual([['hello', 'world']]);
  });

  it('handles commas inside quoted fields', () => {
    expect(rows('"one,two",three')).toEqual([['one,two', 'three']]);
  });

  it('handles escaped double-quotes (RFC 4180)', () => {
    expect(rows('"he said ""hi""",ok')).toEqual([['he said "hi"', 'ok']]);
  });

  it('handles empty fields', () => {
    expect(rows('a,,c')).toEqual([['a', '', 'c']]);
  });

  it('handles trailing comma -> empty last field', () => {
    expect(rows('a,b,')).toEqual([['a', 'b', '']]);
  });

  it('handles single field', () => {
    expect(rows('hello')).toEqual([['hello']]);
  });

  it('handles empty string', () => {
    expect(rows('')).toEqual([]);
  });

  it('splits records on any line ending and skips blank lines', () => {
    expect(rows('a,b\r\nc,d\n\n\re,f\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ]);
  });

  it('keeps line breaks inside a quoted field as written', () => {
    expect(rows('"one\ntwo",x\r\n"three\r\nfour",y')).toEqual([
      ['one\ntwo', 'x'],
      ['three\r\nfour', 'y'],
    ]);
  });

  it('round-trips through csvRow, line breaks included', () => {
    const original = ['FormID', 'NPC_ ', 'Property\\Value', 'He said "hello"', ''];
    const multiLine = ['BOOK', 'Day one.\nThe raiders came.', ''];
    expect(rows(`${csvRow(original)}\n${csvRow(multiLine)}`)).toEqual([original, multiLine]);
  });
});

describe('csvRow', () => {
  it('quotes all fields', () => {
    expect(csvRow(['a', 'b'])).toBe('"a","b"');
  });

  it('escapes internal double-quotes', () => {
    expect(csvRow(['say "hi"'])).toBe('"say ""hi"""');
  });

  it('handles null/undefined fields gracefully', () => {
    expect(csvRow([null as unknown as string, undefined as unknown as string])).toBe('"",""');
  });
});
