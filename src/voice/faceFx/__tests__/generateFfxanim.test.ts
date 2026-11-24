import { afterAll, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The game registry (test setup) already evaluated the voice modules; start from an
// empty registry so the mocks below are what the module under test links to.
jest.resetModules();

const hosts = jest.fn<() => string[]>();
const run = jest.fn(async (work: (host: string) => Promise<void>) => work('http://tools-a'));
const healthy = jest.fn(async (_service: string) => undefined);
const remote = jest.fn(async (..._args: unknown[]) => undefined);

jest.unstable_mockModule('../../../services/pools', () => ({
  servicePool: () => ({ hosts, run }),
}));
jest.unstable_mockModule('../../../pipeline/waitForHealthy', () => ({
  ensureDependencyHealthy: healthy,
}));
jest.unstable_mockModule('../../bethesdaTools', () => ({
  generateFfxanimViaRemote: remote,
}));

const { generateFfxanimFile } = await import('../generateFfxanim');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-ffxanim-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('generateFfxanimFile', () => {
  it('waits for a healthy tools instance and runs the remote call on a pool host', async () => {
    hosts.mockReturnValue(['http://tools-a']);
    const target = path.join(dir, 'voice', 'npcfandreja', '00ae4a02.ffxanim');

    await generateFfxanimFile('sf1', '/in.wav', target, 'Привіт', 'female');

    expect(healthy).toHaveBeenCalledWith('tools');
    expect(remote).toHaveBeenCalledWith(
      'http://tools-a',
      'sf1',
      '/in.wav',
      target,
      'Привіт',
      'female',
    );
    expect(fs.existsSync(path.dirname(target))).toBe(true);
  });

  it('fails clearly when no bethesda-tools instance is configured', async () => {
    hosts.mockReturnValue([]);
    remote.mockClear();
    await expect(
      generateFfxanimFile('sf1', '/in.wav', path.join(dir, 'x.ffxanim'), 'Hi', 'male'),
    ).rejects.toThrow('No bethesda-tools instance');
    expect(remote).not.toHaveBeenCalled();
  });
});
