import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plugin, record, struct, u32 } from '../../../formats/esp/__tests__/pluginBytes';
import { _resetInfoVoiceResponseCacheForTests } from '../../../voice/infoResponseNumbers';
import { buildVoiceFolderMap, buildWemTakeFolders } from '../speakerMaps';

/** Starfield `TRDA`: emotion, WEM file id, emotion-out — 12 bytes. */
const trda = (wemId: number): Buffer => struct('TRDA', 12, (d) => d.writeUInt32LE(wemId, 4));

const info = (formId: number, wemIds: number[]): Buffer =>
  record(
    'INFO',
    formId,
    wemIds.flatMap((wemId, i) => [trda(wemId), u32('NAM1', i + 1)]),
  );

describe('buildWemTakeFolders', () => {
  let dir: string;
  const touch = (rel: string): void => {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wem-folders-'));
    fs.writeFileSync(
      path.join(dir, 'Starfield.esm'),
      plugin([info(0x00012345, [0x00ae4a02, 0x00ae4a03]), info(0x00000777, [0x00000abc])], 0x81),
    );
  });

  afterEach(() => {
    _resetInfoVoiceResponseCacheForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('maps every folder holding a take to its line and response', () => {
    touch('Sound/Voice/Starfield.esm/NPCFAndreja/00ae4a02.wem');
    touch('Sound/Voice/Starfield.esm/NPCFAndreja/00ae4a02.ffxanim');
    touch('Sound/Voice/Starfield.esm/GenericMale01/00ae4a02.wem');
    touch('Sound/Voice/Starfield.esm/NPCFAndreja/00ae4a03.wem');
    touch('Sound/Voice/Starfield.esm/GenericMale01/deadbeef.wem');

    const folders = buildWemTakeFolders(path.join(dir, 'Starfield.esm'));
    expect([...folders.keys()]).toEqual(['012345']);
    const line = folders.get('012345')!;
    expect([...line.get(1)!].sort()).toEqual(['GenericMale01', 'NPCFAndreja']);
    expect([...line.get(2)!]).toEqual(['NPCFAndreja']);
  });

  it('is empty without a voice folder, and the FormID-named scan ignores .wem', () => {
    const pluginPath = path.join(dir, 'Starfield.esm');
    expect(buildWemTakeFolders(pluginPath).size).toBe(0);
    touch('sound/voice/starfield.esm/NPCFAndreja/00ae4a02.wem');
    expect(buildWemTakeFolders(pluginPath).get('012345')?.get(1)).toEqual(new Set(['NPCFAndreja']));
    expect(buildVoiceFolderMap(pluginPath).size).toBe(0);
  });
});
