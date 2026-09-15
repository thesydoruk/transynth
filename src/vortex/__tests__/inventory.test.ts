import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildVortexInventory } from '../buildInventory';
import { merkleContentHash } from '../hashSubset';
import { isOfficialGamePlugin } from '../gameProfiles';
import { scanStagingUnits, stagingPluginBasenames } from '../scanStaging';

const writeFile = (filePath: string, body = 'hello'): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body);
};

describe('vortex inventory', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-inv-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('scans unpacked staging folders and ignores archives', async () => {
    const staging = path.join(root, 'staging');
    const modDir = path.join(staging, 'Cool Mod-12345-1-0-1');
    writeFile(path.join(modDir, 'CoolMod.esp'), 'plugin');
    writeFile(path.join(modDir, 'Strings', 'CoolMod_en.STRINGS'), 's');
    writeFile(path.join(modDir, 'CoolMod-12345.7z'), 'archive-should-be-ignored');
    writeFile(path.join(modDir, 'Textures', 'x.dds'), 'tex');

    const units = await scanStagingUnits(staging);
    expect(units).toHaveLength(1);
    expect(units[0]?.name).toBe('Cool Mod');
    expect(units[0]?.nexusModId).toBe(12345);
    expect(units[0]?.files.map((f) => f.relPath).sort()).toEqual([
      'CoolMod.esp',
      'Strings/CoolMod_en.STRINGS',
    ]);
  });

  it('keeps game masters out of staging-owned plugins', async () => {
    const staging = path.join(root, 'staging');
    const gameDir = path.join(root, 'game');
    writeFile(path.join(staging, 'Some Patch-9-1', 'DLCCoast.esm'), 'stolen');
    writeFile(path.join(gameDir, 'Data', 'Fallout4.esm'), 'base');
    writeFile(path.join(gameDir, 'Data', 'DLCCoast.esm'), 'dlc');

    const inventory = await buildVortexInventory({
      game: 'fo4',
      stagingPath: staging,
      gameDir,
    });
    const names = inventory.units.map((unit) => unit.pluginFileName);
    expect(names).toContain('Fallout4.esm');
    expect(names).toContain('DLCCoast.esm');
    expect(inventory.units.filter((u) => u.pluginFileName === 'DLCCoast.esm')).toHaveLength(1);
    expect(inventory.units.find((u) => u.pluginFileName === 'DLCCoast.esm')?.channel).toBe('mods');
  });

  it('hashes the same file set stably', async () => {
    const folder = path.join(root, 'mod');
    writeFile(path.join(folder, 'A.esp'), 'a');
    writeFile(path.join(folder, 'B.txt'), 'b');
    const files = [
      { absPath: path.join(folder, 'B.txt'), relPath: 'B.txt' },
      { absPath: path.join(folder, 'A.esp'), relPath: 'A.esp' },
    ];
    const first = await merkleContentHash(files);
    const second = await merkleContentHash([...files].reverse());
    expect(first).toBe(second);
  });

  it('recognizes Creation Club plugins as official', () => {
    expect(isOfficialGamePlugin('fo4', 'ccBGSFO4044-HellfirePowerArmor.esl')).toBe(true);
    expect(isOfficialGamePlugin('fo4', 'MyMod.esp')).toBe(false);
  });

  it('collects staging plugin basenames', async () => {
    const staging = path.join(root, 'staging');
    writeFile(path.join(staging, 'Pack-1-1', 'One.esp'), '1');
    writeFile(path.join(staging, 'Pack-1-1', 'Two.esp'), '2');
    const units = await scanStagingUnits(staging);
    const names = stagingPluginBasenames(units);
    expect(names.has('one.esp')).toBe(true);
    expect(names.has('two.esp')).toBe(true);
  });
});
