import { describe, it, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { parseEetHeader, iterEetRecords, parseEetFile } from '..';

const SMALL_EET = path.resolve('test/DOOMThatGun_DE6A1ED8.eet');
const LARGE_EET = path.resolve('test/BDD_Fallout4_EN-RU.eet');

// The samples are not in the repository (test/ is gitignored). Without them
// these tests show as skipped, not as passing without having checked anything.
const withSmall = fs.existsSync(SMALL_EET) ? it : it.skip;
const withLarge = fs.existsSync(LARGE_EET) ? it : it.skip;

describe('parseEetHeader', () => {
  withSmall('parses v1 header (DOOMThatGun)', () => {
    const buf = fs.readFileSync(SMALL_EET);
    const h = parseEetHeader(buf);
    expect(h.version).toBe(1);
    expect(h.gameName).toBe('Fallout 4');
    expect(h.declaredCount).toBe(-1);
    expect(h.recordsOffset).toBeGreaterThan(0);
  });

  withLarge('parses v2 header (BDD)', () => {
    const buf = fs.readFileSync(LARGE_EET);
    const h = parseEetHeader(buf);
    expect(h.version).toBe(2);
    expect(h.declaredCount).toBeGreaterThan(0);
    expect(h.recordsOffset).toBeGreaterThan(0);
  });

  it('rejects non-EET files', () => {
    const buf = Buffer.from('NOT_EET_DATA_1234567890');
    expect(() => parseEetHeader(buf)).toThrow('Invalid EET magic');
  });
});

describe('iterEetRecords (v1 small file)', () => {
  withSmall('yields all records', () => {
    const buf = fs.readFileSync(SMALL_EET);
    const header = parseEetHeader(buf);
    const records = [...iterEetRecords(buf, header.recordsOffset)];
    expect(records.length).toBeGreaterThan(0);
    expect(records.length).toBe(61);
  });

  withSmall('records have expected fields', () => {
    const buf = fs.readFileSync(SMALL_EET);
    const header = parseEetHeader(buf);
    const records = [...iterEetRecords(buf, header.recordsOffset)];
    const first = records[0];
    expect(first.signature).toBeTruthy();
    expect(first.formId).toBeTruthy();
    expect(first.field).toBeTruthy();
    expect(first.source).toBeTruthy();
    expect(typeof first.status).toBe('number');
  });

  withSmall('signatures are 4-char ASCII strings', () => {
    const buf = fs.readFileSync(SMALL_EET);
    const header = parseEetHeader(buf);
    const records = [...iterEetRecords(buf, header.recordsOffset)];
    for (const r of records) {
      expect(r.signature.length).toBe(4);
      expect(/^[A-Z0-9_]{4}$/.test(r.signature)).toBe(true);
    }
  });
});

describe('parseEetFile', () => {
  withSmall('returns header + records for v1 file', () => {
    const buf = fs.readFileSync(SMALL_EET);
    const result = parseEetFile(buf);
    expect(result.header.version).toBe(1);
    expect(result.records.length).toBe(61);
  });
});

describe('iterEetRecords (v2 large file)', () => {
  withLarge('yields declared record count', () => {
    const buf = fs.readFileSync(LARGE_EET);
    const header = parseEetHeader(buf);
    const records = [...iterEetRecords(buf, header.recordsOffset)];
    expect(records.length).toBe(header.declaredCount);
  });
});
