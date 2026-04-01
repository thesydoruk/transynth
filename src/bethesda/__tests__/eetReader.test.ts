import { describe, it, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { parseEetHeader, iterEetRecords, parseEetFile } from '../EetReader.js';

const SMALL_EET = path.resolve('test/DOOMThatGun_DE6A1ED8.eet');
const LARGE_EET = path.resolve('test/BDD_Fallout4_EN-RU.eet');

describe('parseEetHeader', () => {
  it('parses v1 header (DOOMThatGun)', () => {
    if (!fs.existsSync(SMALL_EET)) return;
    const buf = fs.readFileSync(SMALL_EET);
    const h = parseEetHeader(buf);
    expect(h.version).toBe(1);
    expect(h.gameName).toBe('Fallout 4');
    expect(h.declaredCount).toBe(-1);
    expect(h.recordsOffset).toBeGreaterThan(0);
  });

  it('parses v2 header (BDD)', () => {
    if (!fs.existsSync(LARGE_EET)) return;
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
  it('yields all records', () => {
    if (!fs.existsSync(SMALL_EET)) return;
    const buf = fs.readFileSync(SMALL_EET);
    const header = parseEetHeader(buf);
    const records = [...iterEetRecords(buf, header.recordsOffset)];
    expect(records.length).toBeGreaterThan(0);
    expect(records.length).toBe(61);
  });

  it('records have expected fields', () => {
    if (!fs.existsSync(SMALL_EET)) return;
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

  it('signatures are 4-char ASCII strings', () => {
    if (!fs.existsSync(SMALL_EET)) return;
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
  it('returns header + records for v1 file', () => {
    if (!fs.existsSync(SMALL_EET)) return;
    const buf = fs.readFileSync(SMALL_EET);
    const result = parseEetFile(buf);
    expect(result.header.version).toBe(1);
    expect(result.records.length).toBe(61);
  });
});

describe('iterEetRecords (v2 large file)', () => {
  it('yields declared record count', () => {
    if (!fs.existsSync(LARGE_EET)) return;
    const buf = fs.readFileSync(LARGE_EET);
    const header = parseEetHeader(buf);
    const records = [...iterEetRecords(buf, header.recordsOffset)];
    expect(records.length).toBe(header.declaredCount);
  });
});