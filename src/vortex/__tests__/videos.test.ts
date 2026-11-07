import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractArchive } from '../../tools/archiveUtils';
import { buildVortexInventory } from '../buildInventory';
import { packVortexUnitZip } from '../packUnit';
import { scanStagingUnits } from '../scanStaging';
import { hasVortexImportAnchor, isVortexSyncFile } from '../syncWorthy';
import { isTransynthVideopackFolder, isVideoRelPath } from '../videoFiles';

const writeFile = (filePath: string, body = 'hello'): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body);
};

describe('cutscene videos in the inventory', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-videos-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('knows a video by its folder and extension, and our videopack by its name', () => {
    expect(isVideoRelPath('Video/Intro_ru.bk2')).toBe(true);
    expect(isVideoRelPath('Data\\Video\\LUCK.BK2')).toBe(true);
    expect(isVideoRelPath('Video/readme.txt')).toBe(false);
    expect(isVideoRelPath('Sound/Video/x.bk2')).toBe(false);
    expect(isVideoRelPath('Intro_ru.bk2')).toBe(false);
    expect(isTransynthVideopackFolder('Transynth_fo4_uk_videopack_r2')).toBe(true);
    expect(isTransynthVideopackFolder('Transynth_fo4_uk_langpack_r2')).toBe(false);
    // Counted only when the agent dubs videos; an anchor of its own either way.
    expect(isVortexSyncFile('/m/Video/Intro_ru.bk2', 'Intro_ru.bk2', 'Video/Intro_ru.bk2')).toBe(
      false,
    );
    expect(
      isVortexSyncFile('/m/Video/Intro_ru.bk2', 'Intro_ru.bk2', 'Video/Intro_ru.bk2', {
        videos: true,
      }),
    ).toBe(true);
    expect(hasVortexImportAnchor(['Video/Intro_ru.bk2'])).toBe(true);
  });

  it('lists the game videos with the main master, reading a video our pack deployed from its backup', async () => {
    const gameDir = path.join(root, 'game');
    const data = path.join(gameDir, 'Data');
    writeFile(path.join(data, 'Fallout4.esm'), 'base');
    writeFile(path.join(data, 'DLCCoast.esm'), 'dlc');
    writeFile(path.join(data, 'Video', 'Intro_ru.bk2'), 'our dub');
    writeFile(path.join(data, 'Video', 'Intro_ru.bk2.vortex_backup'), 'the game file');
    writeFile(path.join(data, 'Video', 'LUCK.bk2'), 'luck');
    writeFile(path.join(data, 'Video', 'Mod.bk2'), 'some mod');
    writeFile(
      path.join(data, 'vortex.deployment.json'),
      JSON.stringify({
        files: [
          { relPath: 'Video\\Intro_ru.bk2', source: 'Transynth_fo4_uk_videopack_r1' },
          { relPath: 'Video\\Mod.bk2', source: 'Some Video Mod' },
        ],
      }),
    );
    const scan = (videos: boolean) =>
      buildVortexInventory({
        game: 'fo4',
        stagingPath: path.join(root, 's'),
        gameDir,
        channel: 'game',
        videos,
      });

    const without = await scan(false);
    expect(without.units.flatMap((u) => u.files.map((f) => f.relPath))).toEqual([
      'DLCCoast.esm',
      'Fallout4.esm',
    ]);

    const inventory = await scan(true);
    const master = inventory.units.find((u) => u.pluginFileName === 'Fallout4.esm')!;
    expect(master.files.map((f) => [f.relPath, path.basename(f.absPath)])).toEqual([
      ['Fallout4.esm', 'Fallout4.esm'],
      ['Video/Intro_ru.bk2', 'Intro_ru.bk2.vortex_backup'],
      ['Video/LUCK.bk2', 'LUCK.bk2'],
    ]);
    // A DLC owns no videos; a video another mod deployed is that mod's.
    const dlc = inventory.units.find((u) => u.pluginFileName === 'DLCCoast.esm')!;
    expect(dlc.files.map((f) => f.relPath)).toEqual(['DLCCoast.esm']);
    expect(inventory.units.find((u) => u.pluginFileName === 'Fallout4.esm')!.contentHash).not.toBe(
      without.units.find((u) => u.pluginFileName === 'Fallout4.esm')!.contentHash,
    );
  });

  it("lists a mod's own videos with the mod, a video-only folder as a unit, and never our videopack", async () => {
    const staging = path.join(root, 'staging');
    writeFile(path.join(staging, 'Cool Mod-1-1', 'CoolMod.esp'), 'plugin');
    writeFile(path.join(staging, 'Cool Mod-1-1', 'Video', 'CoolIntro.bk2'), 'video');
    writeFile(path.join(staging, 'Better Intro-7-2', 'Video', 'Intro_ru.bk2'), 'video');
    writeFile(path.join(staging, 'Transynth_fo4_uk_videopack_r1', 'Video', 'Intro_ru.bk2'), 'd');

    const plain = await scanStagingUnits(staging);
    expect(plain.map((u) => [u.name, u.files.map((f) => f.relPath)])).toEqual([
      ['Cool Mod', ['CoolMod.esp']],
    ]);

    const withVideos = await scanStagingUnits(staging, undefined, { videos: true });
    expect(withVideos.map((u) => [u.unitId, u.files.map((f) => f.relPath)])).toEqual([
      ['mods:better intro-7-2:folder', ['Video/Intro_ru.bk2']],
      ['mods:cool mod-1-1:coolmod', ['CoolMod.esp', 'Video/CoolIntro.bk2']],
    ]);
  });

  it('packs a unit with manifests in place of its videos, and without them when nobody describes', async () => {
    const folder = path.join(root, 'mod');
    writeFile(path.join(folder, 'CoolMod.esp'), 'plugin');
    writeFile(path.join(folder, 'Video', 'CoolIntro.bk2'), 'video bytes');
    const [unit] = await scanStagingUnits(root, undefined, { videos: true });
    const zipPath = path.join(root, 'unit.zip');

    await packVortexUnitZip(unit!, zipPath, {
      describeVideo: async (file) => ({
        fileName: path.basename(file.relPath),
        byteSize: 11,
        sha1: 'd'.repeat(40),
        durationS: 12,
        trackIds: [0],
        sourceTrackId: 0,
      }),
    });
    const unzip = async (): Promise<{ dir: string; files: string[] }> => {
      const dir = fs.mkdtempSync(path.join(root, 'unzip-'));
      await extractArchive(zipPath, dir);
      const files: string[] = [];
      const walk = (at: string) => {
        for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
          const full = path.join(at, entry.name);
          if (entry.isDirectory()) walk(full);
          else files.push(path.relative(dir, full).replace(/\\/g, '/'));
        }
      };
      walk(dir);
      return { dir, files: files.sort() };
    };
    const first = await unzip();
    expect(first.files).toEqual(['CoolMod.esp', 'Video/CoolIntro.bk2.video.json']);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(first.dir, 'Video', 'CoolIntro.bk2.video.json'), 'utf8'),
    );
    expect(manifest).toMatchObject({ fileName: 'CoolIntro.bk2', sha1: 'd'.repeat(40) });

    await packVortexUnitZip(unit!, zipPath);
    expect((await unzip()).files).toEqual(['CoolMod.esp']);
  });
});
