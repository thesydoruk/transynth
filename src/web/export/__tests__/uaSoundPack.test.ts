import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { Ba2Reader } from '../../../formats/ba2';
import {
  UA_SOUND_PACK_BA2,
  UA_SOUND_PACK_ESP,
  splitLangpackVoiceEntries,
  writeUaSoundPackIntoDir,
} from '../uaSoundPack';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('writeUaSoundPackIntoDir', () => {
  it('adds the dummy ESP and an uncompressed Main BA2', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ua-sound-'));
    tempDirs.push(dir);
    const clip = path.join(dir, 'clip.fuz');
    fs.writeFileSync(clip, Buffer.from('fuz-bytes'));

    const added = writeUaSoundPackIntoDir(
      dir,
      [{ name: 'Sound/Voice/Fallout4.esm/NPC/00123456_1.fuz', absPath: clip }],
      'fo4',
    );

    expect(added).toBe(2);
    expect(fs.existsSync(path.join(dir, UA_SOUND_PACK_ESP))).toBe(true);
    expect(fs.statSync(path.join(dir, UA_SOUND_PACK_ESP)).size).toBe(286);
    const ba2Path = path.join(dir, UA_SOUND_PACK_BA2);
    const ba2 = fs.readFileSync(ba2Path);
    expect(ba2.readUInt32LE(24 + 24)).toBe(0);

    const reader = new Ba2Reader(ba2Path);
    try {
      expect(
        reader.extractByName('Sound\\Voice\\Fallout4.esm\\NPC\\00123456_1.fuz')?.toString(),
      ).toBe('fuz-bytes');
    } finally {
      reader.close();
    }
  });

  it('does nothing without voice or on non-FO4', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ua-sound-skip-'));
    tempDirs.push(dir);
    expect(writeUaSoundPackIntoDir(dir, [], 'fo4')).toBe(0);
    expect(
      writeUaSoundPackIntoDir(dir, [{ name: 'Sound/Voice/x.fuz', data: Buffer.from('x') }], 'sse'),
    ).toBe(0);
    expect(fs.existsSync(path.join(dir, UA_SOUND_PACK_ESP))).toBe(false);
  });
});

describe('splitLangpackVoiceEntries', () => {
  it('pulls Sound/Voice out of the loose tree', () => {
    const { rest, voice } = splitLangpackVoiceEntries([
      { name: 'Strings/Fallout4_en.STRINGS', data: Buffer.from('s') },
      { name: 'Sound/Voice/Mod.esp/00123456_1.fuz', data: Buffer.from('v') },
      { name: 'Data/Sound/Voice/Mod.esp/00000001_1.fuz', data: Buffer.from('v2') },
    ]);
    expect(rest.map((file) => file.name)).toEqual(['Strings/Fallout4_en.STRINGS']);
    expect(voice.map((file) => file.name)).toEqual([
      'Sound/Voice/Mod.esp/00123456_1.fuz',
      'Sound/Voice/Mod.esp/00000001_1.fuz',
    ]);
  });
});
