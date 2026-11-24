import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { STARFIELD_RECORD_LAYOUT } from '../../../games/creation-engine/import/recordLayouts';
import {
  formIdMasterIndex,
  parseTes4MasterNames,
  pluginKindFromFlags,
  readPluginHeader,
  readPluginMasterNames,
} from '../pluginHeader';
import { DEFAULT_ESP_RECORD_LAYOUT } from '../recordLayout';

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

describe('readPluginHeader', () => {
  it('returns the TES4 flags with the masters', () => {
    const file = writePlugin('TES4', [subrecord('MAST', 'Starfield.esm')]);
    const bytes = fs.readFileSync(file);
    bytes.writeUInt32LE(0x0101, 8);
    fs.writeFileSync(file, bytes);
    expect(readPluginHeader(file)).toEqual({ flags: 0x0101, masters: ['Starfield.esm'] });
  });
});

describe('pluginKindFromFlags', () => {
  const starfield = STARFIELD_RECORD_LAYOUT.plugin;

  it('reads small and medium Starfield plugins, small winning over medium', () => {
    expect(pluginKindFromFlags(0x0001, starfield)).toBe('full');
    expect(pluginKindFromFlags(0x0101, starfield)).toBe('small');
    expect(pluginKindFromFlags(0x0401, starfield)).toBe('medium');
    expect(pluginKindFromFlags(0x0501, starfield)).toBe('small');
    // 0x200 is Starfield's Update flag, not a size class.
    expect(pluginKindFromFlags(0x0201, starfield)).toBe('full');
    expect(pluginKindFromFlags(0x0000, starfield, 'Patch.ESL')).toBe('small');
  });

  it('calls every plugin full under the default layout', () => {
    expect(pluginKindFromFlags(0x0301, DEFAULT_ESP_RECORD_LAYOUT.plugin, 'x.esl')).toBe('full');
  });
});

describe('formIdMasterIndex', () => {
  it('indexes MAST by the top byte in the plain layout', () => {
    const kinds = ['full', 'full'] as const;
    expect(formIdMasterIndex(0x0000_0800, kinds, 'plain')).toBe(0);
    expect(formIdMasterIndex(0x0100_0800, kinds, 'plain')).toBe(1);
    expect(formIdMasterIndex(0x0200_0800, kinds, 'plain')).toBe(-1);
    // An ESL-flagged FE FormID is past the list: the plugin's own record.
    expect(formIdMasterIndex(0xfe00_0800, kinds, 'plain')).toBe(-1);
  });

  it('numbers full, small and medium Starfield masters separately', () => {
    // MAST: Starfield.esm (full), SmallA.esm (small), Mid.esm (medium),
    //       Constellation.esm (full), SmallB.esm (small).
    const kinds = ['full', 'small', 'medium', 'full', 'small'] as const;
    expect(formIdMasterIndex(0x0001_2345, kinds, 'byKind')).toBe(0);
    expect(formIdMasterIndex(0x0101_2345, kinds, 'byKind')).toBe(3);
    expect(formIdMasterIndex(0x0201_2345, kinds, 'byKind')).toBe(-1);
    expect(formIdMasterIndex(0xfe00_0abc, kinds, 'byKind')).toBe(1);
    expect(formIdMasterIndex(0xfe00_1abc, kinds, 'byKind')).toBe(4);
    expect(formIdMasterIndex(0xfe00_2abc, kinds, 'byKind')).toBe(-1);
    expect(formIdMasterIndex(0xfd00_1234, kinds, 'byKind')).toBe(2);
    expect(formIdMasterIndex(0xfd01_1234, kinds, 'byKind')).toBe(-1);
  });
});
