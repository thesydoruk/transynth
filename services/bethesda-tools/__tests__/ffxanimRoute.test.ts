import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  createFfxanimHandler,
  createStarfieldLipService,
  parseFfxanimRequest,
} from '../ffxanimRoute';
import type { ToolRunner } from '../ffxanim';
import { createStarfieldToolsCache } from '../starfieldTools';
import { createWineSlotPool } from '../wineSlots';
import { nodeToolRunner, tinyWav, writeFakeStarfieldTools } from './fakeStarfieldTools';

const wav64 = tinyWav().toString('base64');

describe('parseFfxanimRequest', () => {
  it('takes text, wav, actor and an optional safe name', () => {
    expect(parseFfxanimRequest({ text: 'Hi', wav: wav64, actor: 'female' })).toMatchObject({
      text: 'Hi',
      actor: 'female',
      name: 'take',
    });
    expect(
      parseFfxanimRequest({ text: '', wav: wav64, actor: 'male', name: '00ae4a02', game: 'sf1' }),
    ).toMatchObject({ text: '', name: '00ae4a02' });
  });

  it('refuses a missing field, an unknown rig, a non-WAV and an unsafe name', () => {
    const bad = [
      { wav: wav64, actor: 'male' },
      { text: 'Hi', actor: 'male' },
      { text: 'Hi', wav: wav64, actor: 'robot' },
      { text: 'Hi', wav: Buffer.alloc(64, 1).toString('base64'), actor: 'male' },
      { text: 'Hi', wav: wav64, actor: 'male', name: '..\\x' },
      { text: 'Hi', wav: wav64, actor: 'male', name: '' },
    ];
    for (const body of bad) expect(parseFfxanimRequest(body)).toHaveProperty('error');
  });
});

describe('createStarfieldLipService', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffx-service-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('boots its one prefix once, however many callers ask, and reports it', async () => {
    writeFakeStarfieldTools(path.join(dir, 'mount'));
    const calls: string[] = [];
    const runner =
      (prefix: string): ToolRunner =>
      async (exe, args) => {
        calls.push(`${path.relative(dir, prefix)} ${exe} ${args.join(' ')}`);
        fs.writeFileSync(path.join(prefix, 'system.reg'), '');
        return { code: 0, stdout: '', stderr: '', timedOut: false };
      };
    const inits: string[] = [];
    const service = createStarfieldLipService({
      tools: createStarfieldToolsCache(path.join(dir, 'mount'), path.join(dir, 'local')),
      prefixRoot: path.join(dir, 'ffx64'),
      concurrency: 3,
      runner,
      initPrefix: async (prefix) => {
        inits.push(path.relative(dir, prefix));
      },
      toolPath: (p) => p,
      timeoutMs: 1000,
    });
    expect(service.installed()).toBe(true);
    expect(service.snapshot()).toEqual({ active: 0, concurrency: 3, booted: false });

    await Promise.all([service.warm(), service.warm()]);

    const prefix = path.join('ffx64', 'w0');
    expect(calls).toEqual([`${prefix} wineboot --init`]);
    expect(inits).toEqual([prefix]);
    expect(service.snapshot().booted).toBe(true);
    expect(fs.readdirSync(path.join(dir, 'local'))).toHaveLength(1);
  });
});

describe('POST /v1/ffxanim', () => {
  let dir: string;
  let server: Server;
  let url: string;
  const prepared: string[] = [];

  const start = async (): Promise<void> => {
    const handler = createFfxanimHandler({
      tools: createStarfieldToolsCache(path.join(dir, 'mount'), path.join(dir, 'local')),
      pool: createWineSlotPool(path.join(dir, 'wine'), 2, 1),
      preparePrefix: async (prefix) => {
        prepared.push(prefix);
      },
      runner: () => nodeToolRunner,
      toolPath: (p) => p,
      timeoutMs: 20_000,
      workRoot: path.join(dir, 'work'),
    });
    server = createServer((req, res) => {
      handler(req, res).catch((err: Error) => {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/ffxanim`;
  };

  const post = (body: unknown): Promise<Response> =>
    fetch(url, { method: 'POST', body: JSON.stringify(body) });

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffx-route-'));
    fs.mkdirSync(path.join(dir, 'work'));
    prepared.length = 0;
    await start();
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('answers 503 "not installed" without the tools, and 400 on a bad body', async () => {
    const missing = await post({ text: 'Hi', wav: wav64, actor: 'male' });
    expect(missing.status).toBe(503);
    expect(((await missing.json()) as { error: string }).error).toMatch(
      /^Starfield lip tools are not installed \(missing .*LipGenerator\/LipGenerator\.exe/,
    );
    expect((await post({ text: 'Hi' })).status).toBe(400);
    expect(prepared).toEqual([]);
  });

  it('returns the .ffxanim bytes, respells the text, and leaves no work folder', async () => {
    writeFakeStarfieldTools(path.join(dir, 'mount'));
    const res = await post({ text: '[Тихо] Привіт', wav: wav64, actor: 'female', name: 'ab12' });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-ffxanim-text')).toBe('guided');
    expect(res.headers.get('server-timing')).toMatch(/^lipgen;dur=\d+, ffxc;dur=\d+$/);
    const data = Buffer.from(await res.arrayBuffer());
    const inside = JSON.parse(data.subarray(12).toString('utf8')) as Record<string, string>;
    expect(inside).toMatchObject({
      actor: 'StarfieldHumanFemale',
      group: 'ab12',
      name: 'ab12',
      text: 'Prihveet',
    });
    expect(fs.readdirSync(path.join(dir, 'work'))).toEqual([]);
    expect(prepared).toHaveLength(1);
  });

  it('analyses a line with nothing to read from the audio alone', async () => {
    writeFakeStarfieldTools(path.join(dir, 'mount'));
    const res = await post({ text: '[Сміється]', wav: wav64, actor: 'male' });
    expect(res.headers.get('x-ffxanim-text')).toBe('audio-only');
    const data = Buffer.from(await res.arrayBuffer());
    expect(JSON.parse(data.subarray(12).toString('utf8'))).toMatchObject({
      text: '.',
      name: 'take',
    });
  });

  it('runs requests side by side on separate slots, each in its own folder', async () => {
    writeFakeStarfieldTools(path.join(dir, 'mount'));
    const [a, b] = await Promise.all([
      post({ text: 'One', wav: wav64, actor: 'male', name: 'one' }),
      post({ text: 'Two', wav: wav64, actor: 'female', name: 'two' }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const textOf = async (res: Response): Promise<unknown> =>
      JSON.parse(
        Buffer.from(await res.arrayBuffer())
          .subarray(12)
          .toString('utf8'),
      ).text;
    expect([await textOf(a), await textOf(b)]).toEqual(['One', 'Two']);
    expect(new Set(prepared).size).toBe(2);
    expect(fs.readdirSync(path.join(dir, 'work'))).toEqual([]);
  });

  it('passes a tool failure on with its output', async () => {
    writeFakeStarfieldTools(path.join(dir, 'mount'));
    const res = await post({ text: 'FAIL', wav: wav64, actor: 'male' });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toContain('Unable to find wav file');
    expect(fs.readdirSync(path.join(dir, 'work'))).toEqual([]);
  });
});
