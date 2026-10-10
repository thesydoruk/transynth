import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PATHS } from '../../../paths';
import { removeModDeleteFiles } from '../deleteMods';

type PathKey = 'modUploads' | 'vortexUploads' | 'pexDecompile' | 'voicePreview';
const REDIRECTED: PathKey[] = ['modUploads', 'vortexUploads', 'pexDecompile', 'voicePreview'];

describe('mod delete file cleanup', () => {
  let tmp: string;
  let gameData: string;
  const saved = {} as Record<PathKey, string>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-delete-'));
    for (const key of REDIRECTED) {
      saved[key] = PATHS[key];
      PATHS[key] = path.join(tmp, 'data', key);
      fs.mkdirSync(PATHS[key], { recursive: true });
    }
    gameData = path.join(tmp, 'Skyrim Special Edition', 'Data');
    fs.mkdirSync(gameData, { recursive: true });
  });

  afterEach(() => {
    for (const key of REDIRECTED) PATHS[key] = saved[key];
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('keeps a scanned plugin that lives outside mod storage', async () => {
    const pluginPath = path.join(gameData, 'Scanned.esp');
    fs.writeFileSync(pluginPath, Buffer.from('TES4'));

    await removeModDeleteFiles(
      [{ id: 1, file_name: 'Scanned.esp', esp_path: pluginPath, mod_id: 1 }],
      new Map([[1, pluginPath]]),
    );

    expect(fs.existsSync(pluginPath)).toBe(true);
  });

  it('removes an uploaded plugin stored inside mod storage', async () => {
    const pluginPath = path.join(PATHS.modUploads, 'Uploaded.esp');
    fs.writeFileSync(pluginPath, Buffer.from('TES4'));

    await removeModDeleteFiles(
      [{ id: 2, file_name: 'Uploaded.esp', esp_path: pluginPath, mod_id: 2 }],
      new Map([[2, pluginPath]]),
    );

    expect(fs.existsSync(pluginPath)).toBe(false);
  });

  it('removes a Vortex pack plugin and its extract tree', async () => {
    const extractRoot = path.join(PATHS.vortexUploads, '7', 'v1_abc');
    const pluginPath = path.join(extractRoot, 'Data', 'Pack.esp');
    fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
    fs.writeFileSync(pluginPath, Buffer.from('TES4'));

    await removeModDeleteFiles(
      [{ id: 3, file_name: 'Pack.esp', esp_path: pluginPath, mod_id: 3 }],
      new Map([[3, pluginPath]]),
    );

    expect(fs.existsSync(extractRoot)).toBe(false);
  });
});
