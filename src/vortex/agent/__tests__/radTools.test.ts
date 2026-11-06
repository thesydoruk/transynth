import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  RAD_TOOLS_URL,
  RAD_VIDEO_EXE,
  ensureRadVideoExe,
  findRadVideoExe,
  installRadVideoTools,
} from '../radTools';

const fakeFetch = (bytes: number, status = 200) =>
  (async () =>
    new Response(status === 200 ? new Uint8Array(bytes) : null, {
      status,
    })) as unknown as typeof fetch;

/** A 7-Zip that "extracts" by writing the expected files for each layer. */
const fakeSevenZip = (calls: string[][]) => async (args: string[], mountRoot: string) => {
  calls.push(args);
  const out = args.find((a) => a.startsWith('-o'))!.slice('-o/work/'.length);
  const dir = path.join(mountRoot, out);
  fs.mkdirSync(dir, { recursive: true });
  if (args.includes('/work/RADTools.7z')) fs.writeFileSync(path.join(dir, 'radtools.exe'), 'nsis');
  else fs.writeFileSync(path.join(dir, RAD_VIDEO_EXE), 'MZ radvideo');
};

describe('RAD Video Tools install', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radtools-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('downloads the archive, opens both layers with the published password and keeps the exe', async () => {
    const calls: string[][] = [];
    const log: string[] = [];
    const exe = await installRadVideoTools({
      toolsDir: path.join(dir, 'tools'),
      fetchImpl: fakeFetch(1_200_000),
      sevenZip: fakeSevenZip(calls),
      log: (line) => log.push(line),
    });
    expect(exe).toBe(path.join(dir, 'tools', RAD_VIDEO_EXE));
    expect(fs.readFileSync(exe, 'utf8')).toBe('MZ radvideo');
    expect(calls).toEqual([
      ['x', '-y', '-pRAD', '/work/RADTools.7z', '-o/work/step1'],
      ['x', '-y', '/work/step1/radtools.exe', '-o/work/step2'],
    ]);
    expect(log[0]).toContain(RAD_TOOLS_URL);
    expect(fs.readdirSync(path.join(dir, 'tools'))).toEqual([RAD_VIDEO_EXE]);
  });

  it('refuses a failed or tiny download and leaves the tools folder alone', async () => {
    const tools = path.join(dir, 'tools');
    await expect(
      installRadVideoTools({
        toolsDir: tools,
        fetchImpl: fakeFetch(0, 404),
        sevenZip: fakeSevenZip([]),
      }),
    ).rejects.toThrow(/HTTP 404/);
    await expect(
      installRadVideoTools({
        toolsDir: tools,
        fetchImpl: fakeFetch(500),
        sevenZip: fakeSevenZip([]),
      }),
    ).rejects.toThrow(/only 500 bytes/);
    expect(fs.existsSync(tools)).toBe(false);
  });

  it('installs only when the exe is missing', async () => {
    const tools = path.join(dir, 'tools');
    fs.mkdirSync(tools);
    fs.writeFileSync(path.join(tools, RAD_VIDEO_EXE), 'present');
    expect(findRadVideoExe(tools)).toBe(path.join(tools, RAD_VIDEO_EXE));
    const calls: string[][] = [];
    await ensureRadVideoExe({
      toolsDir: tools,
      fetchImpl: fakeFetch(1),
      sevenZip: fakeSevenZip(calls),
    });
    expect(calls).toEqual([]);
    expect(findRadVideoExe(path.join(dir, 'none'))).toBeNull();
  });
});
