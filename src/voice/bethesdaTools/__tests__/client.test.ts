import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, jest } from '@jest/globals';
import { encodeXwmViaRemote } from '../remoteXwm';
import { generateLipViaRemote } from '../remoteLip';

describe('bethesda-tools remote clients', () => {
  it('POSTs /v1/lip and writes the returned bytes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-lip-'));
    const wavPath = path.join(dir, 'in.wav');
    const lipPath = path.join(dir, 'out.lip');
    fs.writeFileSync(wavPath, Buffer.from('RIFF-wav'));

    const fetchMock = jest.fn(async () => new Response(Buffer.from('LIP-BYTES'), { status: 200 }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      await generateLipViaRemote('http://tools.example', 'fo4', wavPath, lipPath, 'prihveet');
      expect(fs.readFileSync(lipPath).toString()).toBe('LIP-BYTES');
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('POSTs /v1/xwm and writes the returned bytes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-xwm-'));
    const wavPath = path.join(dir, 'in.wav');
    const xwmPath = path.join(dir, 'out.xwm');
    fs.writeFileSync(wavPath, Buffer.from('RIFF-wav'));

    const fetchMock = jest.fn(async () => new Response(Buffer.from('XWM-BYTES'), { status: 200 }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      await encodeXwmViaRemote('http://tools.example', wavPath, xwmPath);
      expect(fs.readFileSync(xwmPath).toString()).toBe('XWM-BYTES');
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
