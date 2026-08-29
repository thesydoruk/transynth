import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectVoiceAssetRoots,
  discoverCreationKitRoots,
  discoverGameVoiceAssets,
  parseSteamLibraryPaths,
  pickFirstGameAsset,
} from '../discoverGameVoiceAssets';

const rootsOnly = { rootsOnly: true } as const;

describe('discoverGameVoiceAssets', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-assets-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds FonixData.cdf and xWMAEncode.exe under a game root', () => {
    const fonix = path.join(tmpDir, 'Data', 'Sound', 'Voice', 'Processing', 'FonixData.cdf');
    const xwma = path.join(tmpDir, 'Tools', 'Audio', 'xWMAEncode.exe');
    fs.mkdirSync(path.dirname(fonix), { recursive: true });
    fs.mkdirSync(path.dirname(xwma), { recursive: true });
    fs.writeFileSync(fonix, 'cdf');
    fs.writeFileSync(xwma, 'exe');

    const discoveries = discoverGameVoiceAssets([tmpDir], rootsOnly);
    expect(discoveries).toHaveLength(1);
    expect(discoveries[0]?.fonixDataPath).toBe(fonix);
    expect(discoveries[0]?.xWmaEncodePath).toBe(xwma);
  });

  it('merges first available assets across multiple roots', () => {
    const rootA = path.join(tmpDir, 'a');
    const rootB = path.join(tmpDir, 'b');
    const fonix = path.join(rootA, 'Data', 'Sound', 'Voice', 'Processing', 'FonixData.cdf');
    const xwma = path.join(rootB, 'Tools', 'Audio', 'xwmaencode.exe');
    fs.mkdirSync(path.dirname(fonix), { recursive: true });
    fs.mkdirSync(path.dirname(xwma), { recursive: true });
    fs.writeFileSync(fonix, 'cdf');
    fs.writeFileSync(xwma, 'exe');

    const merged = pickFirstGameAsset(discoverGameVoiceAssets([rootA, rootB], rootsOnly));
    expect(merged.fonixDataPath).toBe(fonix);
    expect(merged.xWmaEncodePath?.toLowerCase()).toBe(xwma.toLowerCase());
  });

  it('detects Creation Kit roots by CreationKit.exe marker', () => {
    const ckDir = path.join(tmpDir, 'steam', 'steamapps', 'common', 'Fallout 4');
    const fonix = path.join(ckDir, 'Data', 'Sound', 'Voice', 'Processing', 'FonixData.cdf');
    fs.mkdirSync(path.dirname(fonix), { recursive: true });
    fs.writeFileSync(path.join(ckDir, 'CreationKit.exe'), 'ck');
    fs.writeFileSync(fonix, 'cdf');

    const roots = discoverCreationKitRoots(path.join(tmpDir, 'steam'));
    expect(roots).toContain(ckDir);
    expect(discoverGameVoiceAssets([ckDir], rootsOnly)[0]?.fonixDataPath).toBe(fonix);
  });

  it('detects Steam folders with app id suffix (Fallout 4 1946160)', () => {
    const ckDir = path.join(tmpDir, 'steam', 'steamapps', 'common', 'Fallout 4 1946160');
    const fonix = path.join(ckDir, 'Data', 'Sound', 'Voice', 'Processing', 'FonixData.cdf');
    fs.mkdirSync(path.dirname(fonix), { recursive: true });
    fs.writeFileSync(path.join(ckDir, 'CreationKit.exe'), 'ck');
    fs.writeFileSync(fonix, 'cdf');

    const roots = discoverCreationKitRoots(path.join(tmpDir, 'steam'));
    expect(roots).toContain(ckDir);
  });

  it('parses Steam libraryfolders.vdf paths', () => {
    const steamDir = path.join(tmpDir, 'steam');
    fs.mkdirSync(path.join(steamDir, 'steamapps'), { recursive: true });
    fs.writeFileSync(
      path.join(steamDir, 'steamapps', 'libraryfolders.vdf'),
      '"libraryfolders"\n{\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\Games\\\\SteamLibrary"\n\t}\n}\n',
      'utf8',
    );

    const libraries = parseSteamLibraryPaths(steamDir);
    expect(libraries).toContain(path.resolve(steamDir));
    expect(libraries.some((entry) => entry.toLowerCase().includes('steamlibrary'))).toBe(true);
  });

  it('collects explicit extra roots only when they exist', () => {
    const roots = collectVoiceAssetRoots([path.join(tmpDir, 'missing')], rootsOnly);
    expect(roots.map((item) => item.root)).not.toContain(path.join(tmpDir, 'missing'));
  });
});
