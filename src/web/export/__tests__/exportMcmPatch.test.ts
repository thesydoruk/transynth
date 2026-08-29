import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../../../db';
import { parseMcmBuffer, writeMcmBuffer } from '../../../formats/mcm';
import { exportMcmTranslationFiles, listMcmSourceTranslationFiles } from '../exportMcmPatch';

const makeOverlayDb = (rows: Array<{ path: string; export_text: string }>): Tx =>
  ({
    query: async () => ({ rows }),
  }) as unknown as Tx;

describe('exportMcmPatch', () => {
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcm-export-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists FallUI-style source translation files', () => {
    const pkg = path.join(tmpDir, 'FallUI - Inventory');
    const iface = path.join(pkg, 'Interface', 'FallUI Inventory', 'Translation');
    const mcm = path.join(pkg, 'MCM', 'Config', 'FallUI', 'Translation');
    fs.mkdirSync(iface, { recursive: true });
    fs.mkdirSync(mcm, { recursive: true });
    fs.writeFileSync(
      path.join(pkg, 'MCM', 'Config', 'FallUI', 'config.json'),
      JSON.stringify({ modName: 'FallUI', pluginRequirements: [] }),
    );
    fs.writeFileSync(path.join(iface, 'FallUIInv_en.txt'), '$Inv\tInventory\n', 'utf8');
    fs.writeFileSync(path.join(iface, 'FallUIInv_ru.txt'), '$Inv\tИнвентарь\n', 'utf8');
    fs.writeFileSync(path.join(mcm, 'MCM_FallUIInv_en.txt'), '$Opt\tOption\n', 'utf8');

    const anchor = path.join(iface, 'FallUIInv_en.txt');
    const sources = listMcmSourceTranslationFiles(anchor);
    expect(sources.map((s) => s.stem).sort()).toEqual(['FallUIInv', 'MCM_FallUIInv']);
  });

  it('exports patched MCM files into en and ru slots for uk', async () => {
    const pkg = path.join(tmpDir, 'FallUI - Inventory');
    const iface = path.join(pkg, 'Interface', 'FallUI Inventory', 'Translation');
    const cfgDir = path.join(pkg, 'MCM', 'Config', 'FallUI');
    fs.mkdirSync(iface, { recursive: true });
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, 'config.json'),
      JSON.stringify({ modName: 'FallUI', pluginRequirements: [] }),
    );
    fs.writeFileSync(
      path.join(iface, 'FallUIInv_en.txt'),
      writeMcmBuffer([{ key: '$Inv', text: 'Inventory' }]),
    );

    const db = makeOverlayDb([{ path: 'MCM\\$Inv', export_text: 'Інвентар' }]);
    const files = await exportMcmTranslationFiles(
      db,
      1,
      path.join(iface, 'FallUIInv_en.txt'),
      'en',
      'uk',
      'fo4',
    );

    expect(files.map((f) => f.archivePath).sort()).toEqual([
      'Interface/FallUI Inventory/Translation/FallUIInv_en.txt',
      'Interface/FallUI Inventory/Translation/FallUIInv_ru.txt',
    ]);
    expect(files[0]?.changedCount).toBe(1);
    expect(parseMcmBuffer(files[0]!.buffer).get('$Inv')).toBe('Інвентар');
  });
});
