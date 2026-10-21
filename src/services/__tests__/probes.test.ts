import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { ServiceEndpoint } from '../kinds';
import { probeServiceEndpoint } from '../probes';

const embed = (host: string): ServiceEndpoint => ({
  kind: 'embed',
  host,
  maxParallel: 4,
  apiKey: '',
  managed: false,
});

/** Stub `fetch` with a status per URL; unknown URLs reject like a dead host. */
const stubFetch = (statusByUrl: Record<string, number>) => {
  const calls: string[] = [];
  const fetchMock = jest.fn(async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    const status = statusByUrl[url];
    if (status === undefined)
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    return new Response(null, { status });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return calls;
};

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

describe('probeServiceEndpoint (embed)', () => {
  it('accepts a TEI server, which answers /health but 404s /v1/models', async () => {
    const calls = stubFetch({ 'http://tei:8013/health': 200, 'http://tei:8013/v1/models': 404 });
    await expect(probeServiceEndpoint(embed('http://tei:8013'), 1000)).resolves.toEqual({
      ok: true,
    });
    expect(calls).toEqual(['http://tei:8013/health']);
  });

  it('checks /health at the server root when the host carries a /v1 suffix', async () => {
    const calls = stubFetch({ 'http://tei:8013/health': 200 });
    await expect(probeServiceEndpoint(embed('http://tei:8013/v1/'), 1000)).resolves.toEqual({
      ok: true,
    });
    expect(calls).toEqual(['http://tei:8013/health']);
  });

  it('falls back to /v1/models for an OpenAI-compatible server without /health', async () => {
    const calls = stubFetch({ 'http://vllm:8000/health': 404, 'http://vllm:8000/v1/models': 200 });
    await expect(probeServiceEndpoint(embed('http://vllm:8000'), 1000)).resolves.toEqual({
      ok: true,
    });
    expect(calls).toEqual(['http://vllm:8000/health', 'http://vllm:8000/v1/models']);
  });

  it('reports a dead host as unhealthy without throwing', async () => {
    stubFetch({});
    await expect(probeServiceEndpoint(embed('http://down:8013'), 1000)).resolves.toEqual({
      ok: false,
      error: 'health check failed (http://down:8013)',
    });
  });

  it('keeps the llm probe on /v1/models only', async () => {
    const calls = stubFetch({ 'http://vllm:8011/v1/models': 200 });
    const llm: ServiceEndpoint = { ...embed('http://vllm:8011'), kind: 'llm' };
    await expect(probeServiceEndpoint(llm, 1000)).resolves.toEqual({ ok: true });
    expect(calls).toEqual(['http://vllm:8011/v1/models']);
  });
});
