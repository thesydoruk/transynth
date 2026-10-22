import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectVoiceAssetRoots,
  discoverGameVoiceAssets,
  pickFirstGameAsset,
} from '../discoverGameVoiceAssets';

const rootsOnly = { rootsOnly: true } as const;

const writeFonix = (root: string, rel: string): string => {
  const full = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'cdf');
  return full;
};

describe('discoverGameVoiceAssets', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-assets-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds FonixData.cdf under a game root', () => {
    const fonix = writeFonix(tmpDir, 'Data/Sound/Voice/Processing/FonixData.cdf');
    const discoveries = discoverGameVoiceAssets([tmpDir], rootsOnly);
    expect(discoveries).toHaveLength(1);
    expect(discoveries[0]?.fonixDataPath).toBe(fonix);
    expect(discoveries[0]?.source).toBe('env');
  });

  it('finds the Creation Kit layout and skips roots without Fonix', () => {
    const empty = path.join(tmpDir, 'empty');
    fs.mkdirSync(empty);
    const ck = path.join(tmpDir, 'ck');
    const fonix = writeFonix(ck, 'Sound/Voice/Processing/FonixData.cdf');
    const picked = pickFirstGameAsset(discoverGameVoiceAssets([empty, ck], rootsOnly));
    expect(picked.fonixDataPath).toBe(fonix);
    expect(picked.root).toBe(path.resolve(ck));
  });

  it('collects explicit extra roots only when they exist', () => {
    const roots = collectVoiceAssetRoots([path.join(tmpDir, 'missing'), tmpDir], rootsOnly);
    expect(roots).toEqual([{ root: path.resolve(tmpDir), source: 'env' }]);
  });

  it('picks nothing from an empty discovery', () => {
    expect(pickFirstGameAsset([])).toEqual({});
  });
});
