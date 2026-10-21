import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseTes4MasterNames, readPluginMasterNames } from '../pluginHeader';

const subrecord = (sig: string, text: string): Buffer => {
  const data = Buffer.from(`${text}\0`, 'utf8');
  const header = Buffer.alloc(6);
  header.write(sig, 0, 'ascii');
  header.writeUInt16LE(data.length, 4);
  return Buffer.concat([header, data]);
};

const writePlugin = (sig: string, subrecords: Buffer[]): string => {
  const data = Buffer.concat(subrecords);
  const header = Buffer.alloc(24);
  header.write(sig, 0, 'ascii');
  header.writeUInt32LE(data.length, 4);

  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-header-')),
    'TestPlugin.esp',
  );
  fs.writeFileSync(file, Buffer.concat([header, data, Buffer.alloc(64)]));
  return file;
};

describe('readPluginMasterNames', () => {
  it('reads MAST entries in plugin order and skips other subrecords', () => {
    const file = writePlugin('TES4', [
      subrecord('CNAM', 'Bethesda'),
      subrecord('MAST', 'Fallout4.esm'),
      subrecord('MAST', 'DLCCoast.esm'),
      subrecord('SNAM', 'description'),
    ]);

    expect(readPluginMasterNames(file)).toEqual(['Fallout4.esm', 'DLCCoast.esm']);
  });

  it('returns an empty list for a plugin without masters', () => {
    expect(readPluginMasterNames(writePlugin('TES4', [subrecord('CNAM', 'Author')]))).toEqual([]);
  });

  it('rejects a file that does not start with TES4', () => {
    const file = writePlugin('TES3', [subrecord('MAST', 'Morrowind.esm')]);
    expect(() => readPluginMasterNames(file)).toThrow(/expected TES4/);
  });
});

describe('parseTes4MasterNames', () => {
  it('lists MAST names in order from raw TES4 data, ignoring other subrecords', () => {
    const data = Buffer.concat([
      subrecord('CNAM', 'Bethesda'),
      subrecord('MAST', 'Fallout4.esm'),
      subrecord('SNAM', 'description'),
      subrecord('MAST', 'DLCRobot.esm'),
    ]);
    expect(parseTes4MasterNames(data)).toEqual(['Fallout4.esm', 'DLCRobot.esm']);
  });

  it('is empty without masters and stops at the given length', () => {
    expect(parseTes4MasterNames(Buffer.alloc(0))).toEqual([]);
    const first = subrecord('MAST', 'Fallout4.esm');
    const data = Buffer.concat([first, subrecord('MAST', 'DLCRobot.esm')]);
    expect(parseTes4MasterNames(data, first.length)).toEqual(['Fallout4.esm']);
  });
});
