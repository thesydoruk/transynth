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

  it('keeps a shared folder tree while another plugin of it still has a mod', async () => {
    const extractRoot = path.join(PATHS.vortexUploads, '1', 'v1_abc');
    const chapter = path.join(extractRoot, 'SS2_XPAC_Chapter2.esm');
    const main = path.join(extractRoot, 'SS2.esm');
    fs.mkdirSync(extractRoot, { recursive: true });
    fs.writeFileSync(chapter, Buffer.from('TES4'));
    fs.writeFileSync(main, Buffer.from('TES4'));
    fs.writeFileSync(`${extractRoot}.zip`, 'zip');

    await removeModDeleteFiles(
      [{ id: 4, file_name: 'SS2.zip', esp_path: chapter, mod_id: 4 }],
      new Map([[4, chapter]]),
      new Set([extractRoot]),
    );

    expect(fs.existsSync(chapter)).toBe(true);
    expect(fs.existsSync(main)).toBe(true);
    expect(fs.existsSync(`${extractRoot}.zip`)).toBe(true);
  });

  it("removes a Vortex pack's own zip, not a same-named manual upload", async () => {
    const extractRoot = path.join(PATHS.vortexUploads, '1', 'v1_def');
    const pluginPath = path.join(extractRoot, 'Pack.esp');
    const manual = path.join(PATHS.modUploads, 'Pack.zip');
    fs.mkdirSync(extractRoot, { recursive: true });
    fs.writeFileSync(pluginPath, Buffer.from('TES4'));
    fs.writeFileSync(`${extractRoot}.zip`, 'zip');
    fs.writeFileSync(manual, 'someone else');

    await removeModDeleteFiles(
      [{ id: 5, file_name: 'Pack.zip', esp_path: pluginPath, mod_id: 5 }],
      new Map([[5, pluginPath]]),
    );

    expect(fs.existsSync(`${extractRoot}.zip`)).toBe(false);
    expect(fs.existsSync(manual)).toBe(true);
  });
});
