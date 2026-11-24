/** JSON in, JSON or bytes out: the request/response helpers the JSON routes share. */
import type { IncomingMessage, ServerResponse } from 'node:http';

export const MAX_BODY = 32 * 1024 * 1024;

export const readJsonBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY) throw new Error('body too large');
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw) as unknown;
};

export const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
};

export const sendBytes = (
  res: ServerResponse,
  data: Buffer,
  headers: Record<string, string> = {},
): void => {
  res.writeHead(200, {
    ...headers,
    'content-type': 'application/octet-stream',
    'content-length': data.length,
  });
  res.end(data);
};

export const decodeWav = (wavB64: unknown): Buffer | null => {
  if (typeof wavB64 !== 'string' || !wavB64) return null;
  try {
    const wav = Buffer.from(wavB64, 'base64');
    return wav.length >= 16 ? wav : null;
  } catch {
    return null;
  }
};
