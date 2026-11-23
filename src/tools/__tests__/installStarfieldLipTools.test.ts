import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { findStarfieldLipTools, installStarfieldLipTools } from '../installStarfieldLipTools';

const write = (file: string, body: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};

/** The Creation Kit's two folders under `<game>/Tools`, with their own FonixData.cdf. */
const fakeStarfieldInstall = (game: string): void => {
  for (const name of ['LipGenerator.exe', 'FonixData.cdf', 'icudt58.dll', 'libsndfile-1.dll']) {
    write(path.join(game, 'Tools', 'LipGenerator', name), `sf ${name}`);
  }
  for (const name of ['ffxc.exe', 'StarfieldHumanMale.facefx', 'GenesisDefault.facefx']) {
    write(path.join(game, 'Tools', 'FaceFX', name), `sf ${name}`);
  }
};

describe('installStarfieldLipTools', () => {
  let dir: string;
  let voiceDir: string;
  const savedVoiceDir = process.env.VOICE_TOOLS_DIR;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-install-'));
    voiceDir = path.join(dir, 'data', 'tools', 'voice');
    process.env.VOICE_TOOLS_DIR = voiceDir;
  });
  afterEach(() => {
    if (savedVoiceDir === undefined) delete process.env.VOICE_TOOLS_DIR;
    else process.env.VOICE_TOOLS_DIR = savedVoiceDir;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('finds the tools under <game>/Tools or a Tools folder given directly', () => {
    const game = path.join(dir, 'Starfield');
    fakeStarfieldInstall(game);
    expect(findStarfieldLipTools([path.join(dir, 'Fallout 4'), game])).toEqual({
      root: game,
      toolsDir: path.join(game, 'Tools'),
    });
    expect(findStarfieldLipTools([path.join(game, 'Tools')])?.toolsDir).toBe(
      path.join(game, 'Tools'),
    );
    fs.rmSync(path.join(game, 'Tools', 'FaceFX', 'ffxc.exe'));
    expect(findStarfieldLipTools([game])).toBeUndefined();
  });

  it('copies both folders into starfield/ beside, never over, the Fallout FonixData.cdf', () => {
    const game = path.join(dir, 'Starfield');
    fakeStarfieldInstall(game);
    write(path.join(voiceDir, 'FonixData.cdf'), 'fallout fonix');

    const result = installStarfieldLipTools({ gameDirs: [game], rootsOnly: true });

    expect(result).toEqual({
      installDir: path.join(voiceDir, 'starfield'),
      source: path.join(game, 'Tools'),
      copied: 7,
      skipped: false,
    });
    expect(fs.readFileSync(path.join(voiceDir, 'FonixData.cdf'), 'utf8')).toBe('fallout fonix');
    const lip = path.join(voiceDir, 'starfield', 'LipGenerator');
    expect(fs.readdirSync(lip).sort()).toEqual([
      'FonixData.cdf',
      'LipGenerator.exe',
      'icudt58.dll',
      'libsndfile-1.dll',
    ]);
    expect(fs.readFileSync(path.join(lip, 'FonixData.cdf'), 'utf8')).toBe('sf FonixData.cdf');
    expect(fs.readdirSync(path.join(voiceDir, 'starfield', 'FaceFX')).sort()).toEqual([
      'GenesisDefault.facefx',
      'StarfieldHumanMale.facefx',
      'ffxc.exe',
    ]);
  });

  it('skips a copy already in place unless forced, and copies again when a file changed', () => {
    const game = path.join(dir, 'Starfield');
    fakeStarfieldInstall(game);
    installStarfieldLipTools({ gameDirs: [game], rootsOnly: true });

    expect(installStarfieldLipTools({ gameDirs: [game], rootsOnly: true })).toMatchObject({
      skipped: true,
      copied: 0,
    });
    expect(
      installStarfieldLipTools({ gameDirs: [game], rootsOnly: true, force: true }),
    ).toMatchObject({ skipped: false, copied: 7 });

    write(path.join(game, 'Tools', 'FaceFX', 'ffxc.exe'), 'a newer, longer ffxc');
    expect(installStarfieldLipTools({ gameDirs: [game], rootsOnly: true })).toMatchObject({
      skipped: false,
      copied: 7,
    });
  });

  it('does nothing for a folder without the Starfield tools', () => {
    const fallout = path.join(dir, 'Fallout 4');
    write(path.join(fallout, 'Data', 'Sound', 'Voice', 'Processing', 'FonixData.cdf'), 'cdf');
    expect(installStarfieldLipTools({ gameDirs: [fallout], rootsOnly: true })).toEqual({
      installDir: path.join(voiceDir, 'starfield'),
      copied: 0,
      skipped: false,
    });
    expect(fs.existsSync(path.join(voiceDir, 'starfield'))).toBe(false);
  });
});
