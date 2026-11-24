import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FfxanimToolError,
  ffxcArgs,
  ffxcProjectText,
  findFfxanimFiles,
  generateFfxanim,
  isFfxRuntimeFile,
  lipGeneratorArgs,
  parseFfxcBuildSummary,
  wineToolRunner,
  type ToolRunner,
} from '../ffxanim';
import { starfieldToolPaths } from '../starfieldTools';
import { nodeToolRunner, tinyWav, writeFakeStarfieldTools } from './fakeStarfieldTools';

describe('command lines and the project file', () => {
  const tools = starfieldToolPaths('/opt/sf');
  // What toWinePath gives on Linux, spelled out so the test also runs on Windows.
  const winePath = (p: string): string => `Z:${p.replace(/\//g, '\\')}`;

  it('calls LipGenerator the way the Creation Kit does, with Wine paths', () => {
    const args = lipGeneratorArgs(tools, winePath, {
      wav: '/tmp/w/00ae4a02.wav',
      text: 'Hello there.',
      actor: 'female',
      animset: '/tmp/w/00ae4a02.animset',
      group: '00ae4a02',
    });
    expect(args).toEqual([
      'Z:\\tmp\\w\\00ae4a02.wav',
      'Hello there.',
      'Z:\\opt\\sf\\FaceFX\\StarfieldHumanFemale.facefx',
      'Z:\\opt\\sf\\FaceFX\\GenesisDefault.facefx',
      '-OutputFileName:Z:\\tmp\\w\\00ae4a02.animset',
      '-AnimationGroupName:00ae4a02',
    ]);
  });

  it('writes the .ffxcproj as YAML with CRLF', () => {
    expect(ffxcProjectText('Z:\\a\\StarfieldHumanMale.facefx', ['Z:\\w\\x.animset'])).toBe(
      'version: 10300\r\nitems:\r\n - facefx_file: Z:\\a\\StarfieldHumanMale.facefx\r\n' +
        '   mount_files:\r\n    - Z:\\w\\x.animset\r\n',
    );
  });

  it('builds x86 only, quiet about the warnings the Creation Kit silences', () => {
    expect(ffxcArgs('L', 'O', 'P')).toEqual([
      '-p=x86',
      '-Wno-empty-bone-pose',
      '-Wno-unused-track',
      '-Wno-snap',
      '--time',
      '-l=L',
      '-o=O',
      'P',
    ]);
  });

  it('reads the build summary line of the log', () => {
    const log =
      '*** build time: 00:00:03.378\r\n' +
      '========== Build: 1 succeeded, 0 failed, 0 up-to-date, 0 warnings, 28772 bytes written ==========\r\n';
    expect(parseFfxcBuildSummary(log)).toEqual({ succeeded: 1, failed: 0 });
    expect(parseFfxcBuildSummary('error: cannot read input file')).toBeNull();
  });

  it('recognises a FaceFX runtime file by magic and its own length', () => {
    const data = Buffer.alloc(20);
    data.write('__ffx\0\0\x03', 0, 'latin1');
    data.writeUInt32LE(20, 8);
    expect(isFfxRuntimeFile(data)).toBe(true);
    data.writeUInt32LE(21, 8);
    expect(isFfxRuntimeFile(data)).toBe(false);
    expect(isFfxRuntimeFile(Buffer.from('FACE0000000000000'))).toBe(false);
  });
});

describe('findFfxanimFiles', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffx-find-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('puts <group>/<name>.ffxanim first and finds nothing in an empty folder', () => {
    expect(findFfxanimFiles(path.join(dir, 'missing'), 'g', 'n')).toEqual([]);
    const other = path.join(dir, 'Actor', 'x86', 'other', 'n.ffxanim');
    const wanted = path.join(dir, 'Actor', 'x86', 'g', 'n.ffxanim');
    for (const file of [other, wanted]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'x');
    }
    fs.writeFileSync(path.join(dir, 'Actor', 'x86', 'Actor.ffxactor'), 'x');
    expect(findFfxanimFiles(dir, 'g', 'n')).toEqual([wanted, other]);
  });
});

describe('wineToolRunner', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffx-runner-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  // `node` stands in for `wine`, so `wine <exe> …` runs the script below.
  const runner = wineToolRunner(process.execPath, process.env);

  it('ends with the process, not when a resident child still holds its output pipe', async () => {
    // Like Wine's services, started by the first program in a prefix: they outlive it
    // and keep its stdout open.
    const tool = path.join(dir, 'tool.js');
    fs.writeFileSync(
      tool,
      "const { spawn } = require('node:child_process');\n" +
        "spawn(process.execPath, ['-e', 'setTimeout(() => {}, 8000)'], { stdio: 'inherit' }).unref();\n" +
        "console.log('LipGenerator.exe, Version 1.0.0.1'); process.exitCode = 3;\n",
    );
    const started = Date.now();
    const run = await runner(tool, [], { cwd: dir, timeoutMs: 20_000 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(run).toMatchObject({ code: 3, timedOut: false });
    expect(run.stdout).toContain('LipGenerator.exe, Version 1.0.0.1');
  });

  it('kills a run that outlives its time', async () => {
    const tool = path.join(dir, 'hang.js');
    fs.writeFileSync(tool, 'setTimeout(() => {}, 30000);\n');
    const run = await runner(tool, [], { cwd: dir, timeoutMs: 300 });
    expect(run.timedOut).toBe(true);
  });
});

describe('generateFfxanim with fake executables', () => {
  let tools: string;
  let work: string;
  beforeEach(() => {
    tools = fs.mkdtempSync(path.join(os.tmpdir(), 'ffx-tools-'));
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'ffx-work-'));
    writeFakeStarfieldTools(tools);
  });
  afterEach(() => {
    fs.rmSync(tools, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  });

  const job = (text: string, run: ToolRunner = nodeToolRunner) => ({
    tools: starfieldToolPaths(tools),
    workDir: work,
    wav: tinyWav(),
    text,
    actor: 'male' as const,
    name: '00ae4a02',
    run,
    toolPath: (p: string) => p,
    timeoutMs: 20_000,
  });

  it('returns the .ffxanim ffxc built for the take, named after it', async () => {
    const result = await generateFfxanim(job('Hello there.'));
    expect(isFfxRuntimeFile(result.data)).toBe(true);
    const inside = JSON.parse(result.data.subarray(12).toString('utf8')) as Record<string, string>;
    expect(inside).toMatchObject({
      actor: 'StarfieldHumanMale',
      group: '00ae4a02',
      name: '00ae4a02',
      text: 'Hello there.',
    });
    expect(inside.project).toContain(path.join(work, '00ae4a02.animset'));
    expect(fs.readFileSync(path.join(work, '00ae4a02.wav'))).toEqual(tinyWav());
  });

  it("fails with LipGenerator's own words when it writes no .animset (exit code 0)", async () => {
    const err = await generateFfxanim(job('FAIL please')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FfxanimToolError);
    expect((err as FfxanimToolError).tool).toBe('LipGenerator');
    expect((err as Error).message).toContain('wrote no .animset (exit code 0)');
    expect((err as Error).message).toContain('Unable to find wav file');
  });

  it("fails with the tail of ffxc's log when the build fails (exit code 0)", async () => {
    const err = await generateFfxanim(job('BADBUILD')).catch((e: unknown) => e);
    expect((err as FfxanimToolError).tool).toBe('ffxc');
    expect((err as Error).message).toContain('wrote no .ffxanim (exit code 0)');
    expect((err as Error).message).toContain('the animation group already exists');
    expect((err as Error).message).toContain('Build: 0 succeeded, 1 failed');
  });

  it('reports a tool that ran past its time', async () => {
    const hang: ToolRunner = async () => ({ code: null, stdout: '', stderr: '', timedOut: true });
    await expect(generateFfxanim({ ...job('Hi'), run: hang, timeoutMs: 5 })).rejects.toThrow(
      'LipGenerator: timed out after 5 ms',
    );
  });

  it('refuses a name that could leave the work folder', async () => {
    await expect(generateFfxanim({ ...job('Hi'), name: '../x' })).rejects.toThrow(
      'unsafe animation name',
    );
  });
});
