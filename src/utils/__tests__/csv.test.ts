import { describe, it, expect } from '@jest/globals';
import { parseCsvLine, csvRow } from '../csv';

describe('parseCsvLine', () => {
  it('parses simple unquoted fields', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('parses quoted fields', () => {
    expect(parseCsvLine('"hello","world"')).toEqual(['hello', 'world']);
  });

  it('handles commas inside quoted fields', () => {
    expect(parseCsvLine('"one,two",three')).toEqual(['one,two', 'three']);
  });

  it('handles escaped double-quotes (RFC 4180)', () => {
    expect(parseCsvLine('"he said ""hi""",ok')).toEqual(['he said "hi"', 'ok']);
  });

  it('handles empty fields', () => {
    expect(parseCsvLine('a,,c')).toEqual(['a', '', 'c']);
  });

  it('handles trailing comma -> empty last field', () => {
    expect(parseCsvLine('a,b,')).toEqual(['a', 'b', '']);
  });

  it('handles single field', () => {
    expect(parseCsvLine('hello')).toEqual(['hello']);
  });

  it('handles empty string', () => {
    expect(parseCsvLine('')).toEqual([]);
  });

  it('round-trips through csvRow -> parseCsvLine', () => {
    const original = ['FormID', 'NPC_ ', 'Property\\Value', 'He said "hello"', ''];
    const line = csvRow(original);
    const parsed = parseCsvLine(line);
    expect(parsed).toEqual(original);
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