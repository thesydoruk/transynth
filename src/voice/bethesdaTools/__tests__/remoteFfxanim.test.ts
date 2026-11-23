import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ffxanimNameFor, generateFfxanimViaRemote } from '../remoteFfxanim';

describe('ffxanimNameFor', () => {
  it("uses the take's base name when the service accepts it", () => {
    expect(ffxanimNameFor('/v/starfield.esm/npcfandreja/00ae4a02.ffxanim')).toBe('00ae4a02');
    expect(ffxanimNameFor('C:\\out\\Take_1.FFXANIM')).toBe('Take_1');
  });

  it('leaves the default to the service for anything else', () => {
    expect(ffxanimNameFor('/v/line 1.ffxanim')).toBeUndefined();
    expect(ffxanimNameFor('/v/привіт.ffxanim')).toBeUndefined();
  });
});

describe('generateFfxanimViaRemote', () => {
  let dir: string;
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ffxanim-'));
    fs.writeFileSync(path.join(dir, 'in.wav'), Buffer.from('RIFF-wav'));
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('POSTs raw dialogue, the rig and the take name, and writes the returned bytes', async () => {
    const fetchMock = jest.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(Buffer.from('FFX-BYTES'), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const out = path.join(dir, '00ae4a02.ffxanim');

    await generateFfxanimViaRemote(
      'http://tools.example',
      'sf1',
      path.join(dir, 'in.wav'),
      out,
      '[Тихо] Привіт',
      'female',
    );

    expect(fs.readFileSync(out, 'utf8')).toBe('FFX-BYTES');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://tools.example/v1/ffxanim');
    expect(JSON.parse(String(init.body))).toEqual({
      game: 'sf1',
      text: '[Тихо] Привіт',
      actor: 'female',
      name: '00ae4a02',
      wav: Buffer.from('RIFF-wav').toString('base64'),
    });
  });

  it("surfaces the service's error with the tool output, and writes nothing", async () => {
    const error = 'ffxc: wrote no .ffxanim (exit code 0)\nBuild: 0 succeeded, 1 failed';
    globalThis.fetch = jest.fn(
      async () => new Response(JSON.stringify({ ok: false, error }), { status: 500 }),
    ) as unknown as typeof fetch;
    const out = path.join(dir, 'x.ffxanim');

    await expect(
      generateFfxanimViaRemote('http://t', 'sf1', path.join(dir, 'in.wav'), out, 'Hi', 'male'),
    ).rejects.toThrow(`bethesda-tools /v1/ffxanim HTTP 500: ${error}`);
    expect(fs.existsSync(out)).toBe(false);
  });
});
