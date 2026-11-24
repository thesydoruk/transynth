import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadInfoVoiceSlots,
  voiceVariantFromOrdinal,
  _resetInfoVoiceResponseCacheForTests,
} from '../infoResponseNumbers';
import {
  loadInfoWemIndex,
  lookupLineWemId,
  lookupWemTakeLine,
  wemIdHex,
  wemTakeKey,
} from '../infoWemIds';
import { fuzInfo, wemInfo, writePlugin } from './wemFixtures';

describe('WEM id index of a plugin', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'info-wem-'));
  });

  afterEach(() => {
    _resetInfoVoiceResponseCacheForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const plugin = (name: string, masters: string[], records: Buffer[]): string => {
    const file = path.join(dir, name);
    writePlugin(file, masters, records);
    return file;
  };

  it('formats an id the way the game names the file', () => {
    expect(wemIdHex(0x00ae4a02)).toBe('00ae4a02');
    // The top byte is the plugin's own FormID prefix, not part of the name:
    // SFBGS004.esm (small) carries FE60F139 for `0060f139.wem`,
    // ShatteredSpace.esm (full, one master) 01xxxxxx, a medium master FDxxxxxx.
    expect(wemIdHex(0xfe60f139)).toBe('0060f139');
    expect(wemIdHex(0x01ae4a02)).toBe('00ae4a02');
    expect(wemIdHex(0xfd000abc)).toBe('00000abc');
    expect(wemTakeKey('Starfield.esm', '00AE4A02')).toBe('starfield.esm/00ae4a02');
  });

  it('maps every response to its WEM id and back, with the position as the variant', () => {
    const file = plugin(
      'Starfield.esm',
      [],
      [
        wemInfo(0x00012345, [
          { wemId: 0x00ae4a02, text: 'Hello.' },
          { wemId: 0x00ae4a03, text: 'And again.' },
        ]),
        wemInfo(0x00000777, [{ wemId: 0xfedcba98, text: 'Stay back.' }]),
      ],
    );
    const index = loadInfoWemIndex(file);

    expect(lookupWemTakeLine(index, 'starfield.esm', '00ae4a02')).toEqual({
      origin: 'starfield.esm',
      lineKey: '012345',
      variant: 1,
      infoFormidHex: '00012345',
    });
    expect(lookupWemTakeLine(index, 'Starfield.esm', '00AE4A03')?.variant).toBe(2);
    // A prefixed id is found by the name its file has, and names that file back.
    expect(lookupWemTakeLine(index, 'starfield.esm', '00dcba98')?.lineKey).toBe('000777');
    expect(lookupWemTakeLine(index, 'starfield.esm', 'fedcba98')).toBeUndefined();
    expect(lookupLineWemId(index, 'starfield.esm', '000777', 1)).toBe('00dcba98');

    expect(lookupLineWemId(index, 'starfield.esm', '012345', 2)).toBe('00ae4a03');
    expect(lookupLineWemId(index, 'starfield.esm', '012345', 3)).toBeUndefined();
    expect(lookupWemTakeLine(index, 'starfield.esm', '00000001')).toBeUndefined();
  });

  it('numbers the variant like the text loaders do, counting an empty response', () => {
    const file = plugin(
      'Mod.esm',
      [],
      [
        wemInfo(0x00000042, [
          { wemId: 0x10, text: '' },
          { wemId: 0x11, text: 'Second response, first with text.' },
          { wemId: 0, text: 'Unvoiced.' },
        ]),
      ],
    );
    const slots = loadInfoVoiceSlots(file);
    const responses = slots.responses.get('00000042');
    // What `loadVoiceTranslations` turns the first imported NAM1 row into.
    expect(voiceVariantFromOrdinal(1, responses)).toBe(2);
    expect(voiceVariantFromOrdinal(2, responses)).toBe(3);

    const index = loadInfoWemIndex(file);
    expect(lookupWemTakeLine(index, 'mod.esm', '00000011')?.variant).toBe(2);
    expect(lookupLineWemId(index, 'mod.esm', '000042', 2)).toBe('00000011');
    // No text: no row to pair the file with. No id: no file.
    expect(lookupWemTakeLine(index, 'mod.esm', '00000010')).toBeUndefined();
    expect(lookupLineWemId(index, 'mod.esm', '000042', 3)).toBeUndefined();
  });

  it('files an overridden record under the master that owns it', () => {
    const file = plugin(
      'Patch.esp',
      ['Starfield.esm'],
      [
        wemInfo(0x00012345, [{ wemId: 0xa1, text: 'Fixed line.' }]),
        wemInfo(0x01000800, [{ wemId: 0xb2, text: 'New line.' }]),
      ],
    );
    const index = loadInfoWemIndex(file);
    expect(lookupWemTakeLine(index, 'starfield.esm', '000000a1')?.origin).toBe('starfield.esm');
    expect(lookupWemTakeLine(index, 'patch.esp', '000000b2')?.lineKey).toBe('000800');
    // The same id under the other plugin's folder is another file.
    expect(lookupWemTakeLine(index, 'patch.esp', '000000a1')).toBeUndefined();
  });

  it('gives a shared file to the line it was recorded for, not to a borrower', () => {
    const borrowerFirst = plugin(
      'Borrow.esm',
      [],
      [
        wemInfo(0x00000002, [{ wemId: 0xc3, text: 'Same words.', originalInfo: 0x00000001 }]),
        wemInfo(0x00000001, [{ wemId: 0xc3, text: 'Same words.' }]),
        // `TROI` naming the record itself is not a borrow.
        wemInfo(0x00000003, [{ wemId: 0xd4, text: 'Own.', originalInfo: 0x00000003 }]),
        wemInfo(0x00000004, [{ wemId: 0xd4, text: 'Own.', originalInfo: 0x00000003 }]),
      ],
    );
    const index = loadInfoWemIndex(borrowerFirst);
    expect(lookupWemTakeLine(index, 'borrow.esm', '000000c3')?.lineKey).toBe('000001');
    expect(lookupWemTakeLine(index, 'borrow.esm', '000000d4')?.lineKey).toBe('000003');
    // Both lines still know which file they play.
    expect(lookupLineWemId(index, 'borrow.esm', '000002', 1)).toBe('000000c3');
    expect(lookupLineWemId(index, 'borrow.esm', '000001', 1)).toBe('000000c3');
  });

  it('keeps DNAM aliases for an INFO with no responses of its own', () => {
    const file = plugin(
      'Alias.esm',
      [],
      [
        wemInfo(0x00000010, [{ wemId: 0xe5, text: 'Shared.' }]),
        wemInfo(0x00000011, [], { sharedInfo: 0x00000010 }),
      ],
    );
    const slots = loadInfoVoiceSlots(file);
    expect(slots.sharedFrom.get('alias.esm/000011')).toBe('alias.esm/000010');
    // The alias has no `TRDA`, so the file is the shared INFO's take.
    expect(lookupWemTakeLine(loadInfoWemIndex(file), 'alias.esm', '000000e5')?.lineKey).toBe(
      '000010',
    );
  });

  it('is empty for a plugin whose TRDA carries a response number', () => {
    const file = plugin('Fallout4.esm', [], [fuzInfo(0x001505fb, [1, 102, 103])]);
    const slots = loadInfoVoiceSlots(file);
    expect(slots.responses.get('001505FB')).toEqual([1, 102, 103]);
    expect(slots.wemIds.size).toBe(0);
    expect(loadInfoWemIndex(file).lineOfWem.size).toBe(0);
  });

  it('is empty for a plugin that is not there, and cached with the plugin', () => {
    expect(loadInfoWemIndex(path.join(dir, 'Gone.esm')).wemOfLine.size).toBe(0);
    const file = plugin('Cached.esm', [], [wemInfo(0x1, [{ wemId: 0xf6, text: 'Once.' }])]);
    expect(loadInfoWemIndex(file)).toBe(loadInfoWemIndex(file));
  });
});
