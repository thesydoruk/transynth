import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { writeModImportExtractManifest } from '../../../modImport/archiveManifest';
import { modStorageRoot } from '../../../modStorage/paths';
import {
  discoverCompanionBa2,
  resolveScriptsArchiveFileName,
  resolveStringsArchiveFileName,
} from '../archiveExportPlan';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('archiveExportPlan', () => {
  it('discovers Interface.ba2 before Main.ba2 for FO4 plugins', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), '_extracted_plan-'));
    tempDirs.push(root);
    const pluginPath = path.join(root, 'Fallout4.esm');
    fs.writeFileSync(pluginPath, Buffer.from('TES4'));
    fs.writeFileSync(path.join(root, 'Fallout4 - Main.ba2'), Buffer.from('main'));
    fs.writeFileSync(path.join(root, 'Fallout4 - Interface.ba2'), Buffer.from('iface'));

    expect(discoverCompanionBa2(pluginPath, 'fo4')).toBe(
      path.join(root, 'Fallout4 - Interface.ba2'),
    );
  });

  it('uses import manifest provenance for strings archive naming', () => {
    const root = path.join(modStorageRoot(), `_extracted_plan_${Date.now()}`);
    fs.mkdirSync(root, { recursive: true });
    tempDirs.push(root);
    const pluginPath = path.join(root, 'Data', 'MyMod.esp');
    fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
    fs.writeFileSync(pluginPath, Buffer.from('TES4'));
    writeModImportExtractManifest(root, {
      version: 1,
      extractRoot: root,
      createdAt: new Date().toISOString(),
      archives: [],
      files: {
        'Strings/MyMod_en.STRINGS': {
          sourceArchiveRelativePath: 'MyMod - Interface.ba2',
          entryPath: 'Strings/MyMod_en.STRINGS',
          packing: 'ba2',
        },
      },
    });

    expect(resolveStringsArchiveFileName(pluginPath, 'MyMod', 'fo4')).toBe('MyMod - Interface.ba2');
    expect(resolveScriptsArchiveFileName('MyMod', 'MyMod - Interface.ba2', 'fo4')).toBe(
      'MyMod - Main.ba2',
    );
  });
});
