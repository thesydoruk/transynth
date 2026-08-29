import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from '@jest/globals';
import { EspReader } from '../EspReader';
import { extractInnrWnamRows, readInnrWnamText } from '../innrStrings';

const buildPlugin = (records: Buffer[], localized = false): Buffer => {
  const tes4Data = Buffer.alloc(0);
  const tes4 = Buffer.alloc(24);
  tes4.write('TES4', 0, 4, 'ascii');
  tes4.writeUInt32LE(tes4Data.length, 4);
  if (localized) tes4.writeUInt32LE(0x80, 8);
  return Buffer.concat([tes4, tes4Data, ...records]);
};

const buildRecord = (sig: string, formId: number, subrecords: Buffer[]): Buffer => {
  const data = Buffer.concat(subrecords);
  const header = Buffer.alloc(24);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt32LE(data.length, 4);
  header.writeUInt32LE(0, 8);
  header.writeUInt32LE(formId, 12);
  return Buffer.concat([header, data]);
};

const zstring = (sig: string, text: string): Buffer => {
  const payload = Buffer.from(`${text}\0`, 'utf8');
  const header = Buffer.alloc(6);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt16LE(payload.length, 4);
  return Buffer.concat([header, payload]);
};

const tempFiles: string[] = [];

afterEach(() => {
  for (const file of tempFiles.splice(0)) {
    try {
      fs.unlinkSync(file);
    } catch {
      // ignore cleanup failures in tests
    }
  }
});

const writeTempPlugin = (plugin: Buffer): string => {
  const file = path.join(os.tmpdir(), `innr-test-${Date.now()}-${Math.random()}.esp`);
  fs.writeFileSync(file, plugin);
  tempFiles.push(file);
  return file;
};

describe('innrStrings', () => {
  it('skips empty, asterisk, and zero lstring WNAM values', () => {
    expect(readInnrWnamText(Buffer.from('*'), 0, 1, false)).toBeNull();
    expect(readInnrWnamText(Buffer.alloc(4), 0, 4, true)).toBeNull();
    expect(readInnrWnamText(Buffer.from('Powerful\0'), 0, 9, false)).toBe('Powerful');
    const idBuf = Buffer.alloc(4);
    idBuf.writeUInt32LE(42, 0);
    expect(readInnrWnamText(idBuf, 0, 4, true)).toBe('42');
  });

  it('indexes multiple WNAM subrecords on one INNR record', () => {
    const recordData = Buffer.concat([
      zstring('EDID', 'dn_TestRule'),
      zstring('WNAM', 'Powerful'),
      zstring('WNAM', '*'),
      zstring('WNAM', 'Combat Rifle'),
    ]);

    expect(extractInnrWnamRows(recordData, false)).toEqual([
      { path: 'WNAM[0]', text: 'Powerful' },
      { path: 'WNAM[1]', text: 'Combat Rifle' },
    ]);
  });
});

describe('EspReader INNR extraction', () => {
  it('extracts indexed INNR WNAM rows from a plugin', () => {
    const innr = buildRecord('INNR', 0x00001234, [
      zstring('EDID', 'WeaponModType001'),
      zstring('WNAM', 'Automatic'),
      zstring('WNAM', 'Scoped'),
    ]);
    const pluginPath = writeTempPlugin(buildPlugin([innr]));

    const rows = new EspReader(pluginPath, 'fo4').extractStrings();

    expect(rows).toEqual([
      expect.objectContaining({
        formId: '00001234',
        signature: 'INNR',
        edid: 'WeaponModType001',
        path: 'WNAM[0]',
        text: 'Automatic',
        isLstringId: false,
      }),
      expect.objectContaining({
        path: 'WNAM[1]',
        text: 'Scoped',
      }),
    ]);
  });

  it('reads localized INNR WNAM as lstring ids', () => {
    const innr = buildRecord('INNR', 0x00005678, [
      zstring('EDID', 'WeaponModType002'),
      (() => {
        const header = Buffer.alloc(6);
        header.write('WNAM', 0, 4, 'ascii');
        header.writeUInt16LE(4, 4);
        const data = Buffer.alloc(4);
        data.writeUInt32LE(9001, 0);
        return Buffer.concat([header, data]);
      })(),
    ]);
    const pluginPath = writeTempPlugin(buildPlugin([innr], true));

    const rows = new EspReader(pluginPath, 'fo4').extractStrings();

    expect(rows).toEqual([
      expect.objectContaining({
        path: 'WNAM[0]',
        text: '9001',
        isLstringId: true,
      }),
    ]);
  });
});
