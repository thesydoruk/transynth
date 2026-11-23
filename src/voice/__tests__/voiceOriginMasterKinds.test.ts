/**
 * Small and medium masters on disk, end to end: the master kinds come from each
 * master's own TES4 flags, and the WEM index of a plugin that overrides their
 * dialogue files each line under the master that owns it.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plugin, record, struct, u32 } from '../../formats/esp/__tests__/pluginBytes';
import { readMasterKinds } from '../../formats/esp/pluginHeader';
import { DEFAULT_ESP_RECORD_LAYOUT } from '../../formats/esp/recordLayout';
import { STARFIELD_RECORD_LAYOUT } from '../../games/creation-engine/import/recordLayouts';
import { _resetInfoVoiceResponseCacheForTests } from '../infoResponseNumbers';
import { loadInfoWemIndex, lookupWemTakeLine } from '../infoWemIds';

const SF = STARFIELD_RECORD_LAYOUT.plugin;
const ESM = 0x01;
const SMALL = 0x100;
const MEDIUM = 0x400;

const wemInfo = (formId: number, wemId: number): Buffer =>
  record('INFO', formId, [struct('TRDA', 12, (d) => d.writeUInt32LE(wemId, 4)), u32('NAM1', 1)]);

describe('master kinds and the WEM index of a plugin with small and medium masters', () => {
  let dir: string;
  const write = (name: string, bytes: Buffer): string => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, bytes);
    return file;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'master-kinds-'));
    write('Starfield.esm', plugin([], ESM));
    write('SmallA.esm', plugin([], ESM | SMALL, ['Starfield.esm']));
    write('Medium.esm', plugin([], ESM | MEDIUM, ['Starfield.esm']));
    write('SmallB.esm', plugin([], ESM | SMALL, ['Starfield.esm']));
  });

  afterEach(() => {
    _resetInfoVoiceResponseCacheForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const masters = [
    'Starfield.esm',
    'SmallA.esm',
    'Medium.esm',
    'SmallB.esm',
    'Gone.esm',
    'Light.esl',
  ];

  it("reads each master's kind from its own header; a missing one is unknown", () => {
    const file = write('Patch.esm', plugin([], ESM, masters));
    expect(readMasterKinds(file, masters, SF)).toEqual([
      'full',
      'small',
      'medium',
      'small',
      null,
      'small',
    ]);
    // A title without small or medium plugins never looks.
    expect(readMasterKinds(file, masters, DEFAULT_ESP_RECORD_LAYOUT.plugin)).toEqual(
      masters.map(() => 'full'),
    );
  });

  it("files each overridden line under its owner with the owner's object id", () => {
    const file = write(
      'Patch.esm',
      plugin(
        [
          wemInfo(0x00000100, 0xa0000001), // Starfield.esm
          wemInfo(0xfe001abc, 0xa0000002), // SmallB.esm (second small master)
          wemInfo(0xfd00abcd, 0xa0000003), // Medium.esm
          wemInfo(0x01000800, 0xa0000004), // own: one past the only full master
        ],
        ESM,
        masters.slice(0, 4),
      ),
    );

    const index = loadInfoWemIndex(file, SF);
    expect(lookupWemTakeLine(index, 'starfield.esm', 'a0000001')?.lineKey).toBe('000100');
    expect(lookupWemTakeLine(index, 'smallb.esm', 'a0000002')?.lineKey).toBe('000ABC');
    expect(lookupWemTakeLine(index, 'medium.esm', 'a0000003')?.lineKey).toBe('00ABCD');
    expect(lookupWemTakeLine(index, 'patch.esm', 'a0000004')?.lineKey).toBe('000800');

    // Without the title's rule the top byte indexes MAST, as for Fallout 4.
    const plain = loadInfoWemIndex(file);
    expect(lookupWemTakeLine(plain, 'smalla.esm', 'a0000004')?.lineKey).toBe('000800');
    expect(lookupWemTakeLine(plain, 'patch.esm', 'a0000002')?.lineKey).toBe('001ABC');
  });
});
