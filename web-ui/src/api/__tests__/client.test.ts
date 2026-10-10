import { afterEach, describe, expect, it, vi } from 'vitest';
import { req } from '../client';

const respond = (status: number, body: string, contentType = 'application/json') =>
  vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(body, { status, headers: { 'Content-Type': contentType } }),
  );

describe('req', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the parsed JSON body', async () => {
    vi.stubGlobal('fetch', respond(200, '{"ok":true,"n":3}'));

    await expect(req('/api/thing')).resolves.toEqual({ ok: true, n: 3 });
  });

  it('throws the error message the server sent', async () => {
    vi.stubGlobal('fetch', respond(400, '{"error":"Invalid status"}'));

    await expect(req('/api/thing')).rejects.toThrow('Invalid status');
  });

  it('throws the HTTP status when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', respond(502, '<html>Bad gateway</html>', 'text/html'));

    await expect(req('/api/thing')).rejects.toThrow('HTTP 502');
  });

  it('throws the HTTP status when the error body has no message', async () => {
    vi.stubGlobal('fetch', respond(500, '{}'));

    await expect(req('/api/thing')).rejects.toThrow('HTTP 500');
  });

  // Fastify rejects Content-Type: application/json with an empty body.
  it('sends a JSON content type only when there is a body', async () => {
    const fetch = respond(200, '{}');
    vi.stubGlobal('fetch', fetch);

    await req('/api/thing', { method: 'DELETE' });
    await req('/api/thing', { method: 'POST', body: '{"a":1}' });

    const headers = (call: number) => new Headers(fetch.mock.calls[call]![1]!.headers);
    expect(headers(0).has('Content-Type')).toBe(false);
    expect(headers(1).get('Content-Type')).toBe('application/json');
  });

  it('keeps a content type the caller set', async () => {
    const fetch = respond(200, '{}');
    vi.stubGlobal('fetch', fetch);

    await req('/api/thing', {
      method: 'POST',
      body: 'a,b',
      headers: { 'Content-Type': 'text/csv' },
    });

    expect(new Headers(fetch.mock.calls[0]![1]!.headers).get('Content-Type')).toBe('text/csv');
  });
});
