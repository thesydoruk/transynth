/**
 * A unit upload is framed by hand and streamed, so its length never passes
 * through a Blob (whose size wraps at 4 GiB).
 */
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { createAgentApi } from '../apiClient';
import { multipartFileBody } from '../multipartFile';

const tempDirs: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  await Promise.all(
    servers.splice(0).map((server) => new Promise((done) => server.close(() => done(null)))),
  );
});

const tempFile = (name: string, body: Buffer): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-multipart-'));
  tempDirs.push(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
};

const collect = async (chunks: AsyncGenerator<Buffer>): Promise<Buffer> => {
  const parts: Buffer[] = [];
  for await (const chunk of chunks) parts.push(chunk);
  return Buffer.concat(parts);
};

describe('multipartFileBody', () => {
  it('frames the file as one form-data part and states the true length', async () => {
    const payload = Buffer.from([0, 1, 2, 13, 10, 45, 45, 255]);
    const file = tempFile('Star field.zip', payload);
    const part = multipartFileBody(file, 'application/zip');
    const boundary = part.contentType.replace('multipart/form-data; boundary=', '');
    const body = await collect(part.chunks());

    const head =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="Star field.zip"\r\n' +
      'Content-Type: application/zip\r\n\r\n';
    const tail = `\r\n--${boundary}--\r\n`;
    expect(body.subarray(0, head.length).toString('utf8')).toBe(head);
    expect(body.subarray(head.length, head.length + payload.length)).toEqual(payload);
    expect(body.subarray(head.length + payload.length).toString('utf8')).toBe(tail);
    expect(part.length).toBe(body.length);
  });

  it('streams a file larger than one read without losing a byte', async () => {
    const payload = Buffer.alloc(3 * 1024 * 1024 + 17, 7);
    const part = multipartFileBody(tempFile('big.bin', payload), 'application/octet-stream');
    const body = await collect(part.chunks());
    expect(body.length).toBe(part.length);
    expect(body.includes(payload)).toBe(true);
  });
});

describe('an upload through the agent API', () => {
  it('sends the file as multipart, with the whole content', async () => {
    const payload = Buffer.alloc(2 * 1024 * 1024 + 5, 9);
    const file = tempFile('take.bin', payload);
    const seen: { method?: string; contentType?: string; body?: Buffer } = {};
    const server = http.createServer((req, res) => {
      const parts: Buffer[] = [];
      req.on('data', (chunk: Buffer) => parts.push(chunk));
      req.on('end', () => {
        seen.method = req.method;
        seen.contentType = req.headers['content-type'];
        seen.body = Buffer.concat(parts);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
    const { port } = server.address() as AddressInfo;

    await createAgentApi({ api: `http://127.0.0.1:${port}` }).putVideoFile(1, 2, file);

    expect(seen.method).toBe('PUT');
    expect(seen.contentType).toMatch(/^multipart\/form-data; boundary=----transynth-[0-9a-f]{32}$/);
    expect(seen.body?.includes(payload)).toBe(true);
    expect(seen.body?.toString('latin1')).toContain('filename="take.bin"');
  });
});
