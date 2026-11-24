import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  StarfieldToolsMissingError,
  createStarfieldToolsCache,
  missingStarfieldTools,
  starfieldToolPaths,
} from '../starfieldTools';
import { writeFakeStarfieldTools } from './fakeStarfieldTools';

describe('starfield tools layout and local copy', () => {
  let dir: string;
  let source: string;
  let local: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-tools-'));
    source = path.join(dir, 'mount', 'starfield');
    local = path.join(dir, 'local');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('names every missing file, and nothing once the install is complete', () => {
    expect(missingStarfieldTools(source)).toContain('LipGenerator/LipGenerator.exe');
    expect(missingStarfieldTools(source)).toContain('FaceFX/ffxc.exe');
    writeFakeStarfieldTools(source);
    expect(missingStarfieldTools(source)).toEqual([]);
    fs.rmSync(path.join(source, 'LipGenerator', 'FonixData.cdf'));
    expect(missingStarfieldTools(source)).toEqual(['LipGenerator/FonixData.cdf']);
  });

  it('maps the actor rigs and tools under a root', () => {
    const paths = starfieldToolPaths('/r');
    expect(paths.actor('male')).toBe(path.join('/r', 'FaceFX', 'StarfieldHumanMale.facefx'));
    expect(paths.actor('female')).toBe(path.join('/r', 'FaceFX', 'StarfieldHumanFemale.facefx'));
    expect(paths.analysisActor).toBe(path.join('/r', 'FaceFX', 'GenesisDefault.facefx'));
    expect(paths.lipGenerator).toBe(path.join('/r', 'LipGenerator', 'LipGenerator.exe'));
    expect(paths.ffxc).toBe(path.join('/r', 'FaceFX', 'ffxc.exe'));
  });

  it('refuses with "not installed" while the mount is incomplete', async () => {
    const cache = createStarfieldToolsCache(source, local);
    expect(cache.installed()).toBe(false);
    const err = await cache.ensure().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StarfieldToolsMissingError);
    expect((err as Error).message).toMatch(/^Starfield lip tools are not installed/);
    expect(fs.existsSync(local)).toBe(false);
  });

  it('copies once, shares a copy between concurrent calls, and recopies after a change', async () => {
    writeFakeStarfieldTools(source);
    fs.writeFileSync(path.join(source, 'FaceFX', 'GenesisDeadHead.facefx'), 'extra');
    const cache = createStarfieldToolsCache(source, local);
    const [a, b] = await Promise.all([cache.ensure(), cache.ensure()]);
    expect(a).toBe(b);
    expect(path.dirname(a)).toBe(local);
    expect(fs.readFileSync(path.join(a, 'FaceFX', 'GenesisDeadHead.facefx'), 'utf8')).toBe('extra');
    expect(fs.readdirSync(local)).toEqual([path.basename(a)]);
    expect(await cache.ensure()).toBe(a);

    fs.writeFileSync(path.join(source, 'FaceFX', 'ffxc.exe'), 'a newer ffxc');
    const c = await cache.ensure();
    expect(c).not.toBe(a);
    expect(fs.readFileSync(path.join(c, 'FaceFX', 'ffxc.exe'), 'utf8')).toBe('a newer ffxc');
    expect(fs.readdirSync(local)).toEqual([path.basename(c)]);
  });
});
