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

  it("leaves Transynth's own langpack out of the staging units", async () => {
    const staging = path.join(root, 'staging');
    writeFile(
      path.join(staging, 'Transynth_fo4_uk_langpack_r19', 'Strings', 'Fallout4_en.STRINGS'),
    );
    writeFile(path.join(staging, 'Transynth_fo4_uk_langpack_r19', 'UASoundPack.esp'), 'dummy');
    writeFile(path.join(staging, 'Renamed Pack', 'UASoundPack.esp'), 'dummy');
    writeFile(path.join(staging, 'Renamed Pack', 'Strings', 'Fallout4_en.STRINGS'));
    writeFile(path.join(staging, 'Cool Mod-1-1', 'CoolMod.esp'), 'plugin');

    const units = await scanStagingUnits(staging);
    expect(units.map((unit) => unit.name)).toEqual(['Cool Mod']);
  });

  it('hashes a game unit without the files Vortex deployed into Data', async () => {
    const gameDir = path.join(root, 'game');
    const data = path.join(gameDir, 'Data');
    const scan = () =>
      buildVortexInventory({
        game: 'fo4',
        stagingPath: path.join(root, 's'),
        gameDir,
        channel: 'game',
      });
    writeFile(path.join(data, 'Fallout4.esm'), 'base');
    const pristine = await scan();

    // Our langpack's strings land in Data; without the manifest they look like the game's own.
    writeFile(path.join(data, 'Strings', 'Fallout4_en.STRINGS'), 'translated');
    const unaware = await scan();
    expect(unaware.units[0]?.files.map((f) => f.relPath)).toEqual([
      'Fallout4.esm',
      'Strings/Fallout4_en.STRINGS',
    ]);

    writeFile(
      path.join(data, 'vortex.deployment.json'),
      JSON.stringify({
        files: [
          { relPath: 'Strings\\Fallout4_en.STRINGS', source: 'Transynth_fo4_uk_langpack_r19' },
        ],
      }),
    );
    const aware = await scan();
    expect(aware.units[0]?.files.map((f) => f.relPath)).toEqual(['Fallout4.esm']);
    expect(aware.units[0]?.contentHash).toBe(pristine.units[0]?.contentHash);
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
