import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectNamedPluginFiles, collectPluginUnitFiles } from '../collectSubset';
import { scanStagingUnits } from '../scanStaging';
import {
  hasVortexImportAnchor,
  isVoiceSourceRelPath,
  isVortexSyncArchiveName,
  isVortexSyncFile,
  shouldSkipVortexWalkDir,
} from '../syncWorthy';

const writeGnrlStub = (filePath: string): void => {
  const buf = Buffer.alloc(16);
  buf.write('BTDX', 0, 4, 'ascii');
  buf.write('GNRL', 8, 4, 'ascii');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buf);
};

const writeDx10Stub = (filePath: string): void => {
  const buf = Buffer.alloc(16);
  buf.write('BTDX', 0, 4, 'ascii');
  buf.write('DX10', 8, 4, 'ascii');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buf);
};

describe('vortex sync file selection', () => {
  it('keeps Main / Interface / Voices archives by name', () => {
    expect(isVortexSyncArchiveName('Fallout4 - Interface.ba2')).toBe(true);
    expect(isVortexSyncArchiveName('Fallout4 - Main.ba2')).toBe(true);
    expect(isVortexSyncArchiveName('Fallout4 - Voices.ba2')).toBe(true);
    expect(isVortexSyncArchiveName('DLCCoast - Voices_en.ba2')).toBe(true);
    expect(isVortexSyncArchiveName('Fallout4 - VoicesExtra.ba2')).toBe(true);
    expect(isVortexSyncArchiveName('MyMod.ba2')).toBe(true);
  });

  it('drops mesh / sound / texture dumps', () => {
    expect(isVortexSyncArchiveName('Fallout4 - Meshes.ba2')).toBe(false);
    expect(isVortexSyncArchiveName('Fallout4 - MeshesExtra.ba2')).toBe(false);
    expect(isVortexSyncArchiveName('Fallout4 - Sounds.ba2')).toBe(false);
    expect(isVortexSyncArchiveName('Fallout4 - Textures1.ba2')).toBe(false);
    expect(isVortexSyncArchiveName('Fallout4 - Animations.ba2')).toBe(false);
    expect(isVortexSyncArchiveName('Fallout4 - Materials.ba2')).toBe(false);
  });

  it('keeps loose voice clips under Sound/Voice only', () => {
    expect(isVoiceSourceRelPath('Sound/Voice/CoolMod.esp/Robot/00001234_1.fuz')).toBe(true);
    expect(isVoiceSourceRelPath('Sound/FX/explode.wav')).toBe(false);
    expect(isVoiceSourceRelPath('Scripts/Foo.pex')).toBe(false);
  });

  it('walks Sound/Voice and skips other Sound children', () => {
    expect(shouldSkipVortexWalkDir('/mod', '/mod/Sound', 'Sound')).toBe(false);
    expect(shouldSkipVortexWalkDir('/mod', '/mod/Sound/Voice', 'Voice')).toBe(false);
    expect(shouldSkipVortexWalkDir('/mod', '/mod/Sound/FX', 'FX')).toBe(true);
    expect(shouldSkipVortexWalkDir('/mod', '/mod/Textures', 'Textures')).toBe(true);
  });

  it('collects game files without unpacking archives', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-game-'));
    try {
      fs.writeFileSync(path.join(dataDir, 'Fallout4.esm'), 'esm');
      writeGnrlStub(path.join(dataDir, 'Fallout4 - Interface.ba2'));
      writeGnrlStub(path.join(dataDir, 'Fallout4 - Voices.ba2'));
      writeGnrlStub(path.join(dataDir, 'Fallout4 - Main.ba2'));
      writeGnrlStub(path.join(dataDir, 'Fallout4 - Meshes.ba2'));
      writeGnrlStub(path.join(dataDir, 'Fallout4 - Sounds.ba2'));
      writeDx10Stub(path.join(dataDir, 'Fallout4 - Textures1.ba2'));
      fs.mkdirSync(path.join(dataDir, 'Strings'));
      fs.writeFileSync(path.join(dataDir, 'Strings', 'Fallout4_en.STRINGS'), 's');

      const files = collectNamedPluginFiles(dataDir, 'Fallout4.esm');
      expect(files.map((f) => f.relPath).sort()).toEqual([
        'Fallout4 - Interface.ba2',
        'Fallout4 - Main.ba2',
        'Fallout4 - Voices.ba2',
        'Fallout4.esm',
        'Strings/Fallout4_en.STRINGS',
      ]);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('collects staging translation + voice files and ignores SFX', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-mod-'));
    try {
      fs.writeFileSync(path.join(folder, 'CoolMod.esp'), 'plugin');
      fs.mkdirSync(path.join(folder, 'Interface', 'Translations'), { recursive: true });
      fs.writeFileSync(path.join(folder, 'Interface', 'Translations', 'CoolMod_en.txt'), 'k\tv');
      fs.mkdirSync(path.join(folder, 'Sound', 'Voice', 'CoolMod.esp', 'Robot'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(folder, 'Sound', 'Voice', 'CoolMod.esp', 'Robot', '00001234_1.fuz'),
        'fuz',
      );
      fs.mkdirSync(path.join(folder, 'Sound', 'FX'), { recursive: true });
      fs.writeFileSync(path.join(folder, 'Sound', 'FX', 'boom.wav'), 'sfx');
      fs.writeFileSync(path.join(folder, 'readme.txt'), 'nope');
      writeGnrlStub(path.join(folder, 'CoolMod - Main.ba2'));
      writeGnrlStub(path.join(folder, 'CoolMod - Meshes.ba2'));

      const files = collectPluginUnitFiles(folder, path.join(folder, 'CoolMod.esp'));
      expect(files.map((f) => f.relPath).sort()).toEqual([
        'CoolMod - Main.ba2',
        'CoolMod.esp',
        'Interface/Translations/CoolMod_en.txt',
        'Sound/Voice/CoolMod.esp/Robot/00001234_1.fuz',
      ]);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  it('skips pex-only staging folders that the importer cannot register', async () => {
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-f4se-'));
    try {
      const folder = path.join(staging, 'F4SE-42147-1');
      fs.mkdirSync(path.join(folder, 'Scripts'), { recursive: true });
      fs.writeFileSync(path.join(folder, 'Scripts', 'F4SE.pex'), 'pex');
      expect(hasVortexImportAnchor(['Scripts/F4SE.pex'])).toBe(false);
      expect(await scanStagingUnits(staging)).toEqual([]);
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  });

  it('rejects DX10 texture archives even when named Main', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-dx10-'));
    try {
      writeDx10Stub(path.join(dir, 'Weird - Main.ba2'));
      expect(isVortexSyncFile(path.join(dir, 'Weird - Main.ba2'), 'Weird - Main.ba2')).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
