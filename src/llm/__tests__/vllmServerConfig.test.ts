import { describe, it, expect } from '@jest/globals';
import {
  isAllowedLlmEndpointUrl,
  normalizeVllmServerEntries,
  parseVllmServersJson,
  redactVllmServerEntries,
  resolveVllmServers,
  retainVllmApiKeys,
  totalVllmChatParallel,
} from '../vllmServerConfig';

describe('vllmServerConfig', () => {
  it('normalizes project-settings server arrays', () => {
    expect(
      normalizeVllmServerEntries([
        { host: 'http://a:8000', maxParallel: 4, apiKey: 'k' },
        { url: 'http://b:8001', requests: 2 },
        { host: '' },
      ]),
    ).toEqual([
      { host: 'http://a:8000', maxParallel: 4, apiKey: 'k' },
      { host: 'http://b:8001', maxParallel: 2, apiKey: '' },
    ]);
  });

  it('keeps only http(s) hosts', () => {
    expect(isAllowedLlmEndpointUrl('http://10.0.0.2:8000')).toBe(true);
    expect(isAllowedLlmEndpointUrl('https://llm.example:443')).toBe(true);
    expect(isAllowedLlmEndpointUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedLlmEndpointUrl('localhost:8000')).toBe(false);
    expect(
      normalizeVllmServerEntries([
        { host: 'file:///tmp/weights' },
        { host: 'http://localhost:8000' },
      ]),
    ).toEqual([{ host: 'http://localhost:8000', maxParallel: 1, apiKey: '' }]);
  });

  it('parses VLLM_SERVERS JSON', () => {
    const servers = parseVllmServersJson(
      '[{"host":"http://a:8000","maxParallel":3,"apiKey":"k1"},{"host":"http://b:8001","maxParallel":2,"apiKey":""}]',
    );
    expect(servers).toEqual([
      { host: 'http://a:8000', maxParallel: 3, apiKey: 'k1' },
      { host: 'http://b:8001', maxParallel: 2, apiKey: '' },
    ]);
    expect(totalVllmChatParallel(servers!)).toBe(5);
  });

  it('accepts url alias and clamps maxParallel', () => {
    const servers = parseVllmServersJson('[{"url":"http://localhost:8000","requests":99}]');
    expect(servers).toEqual([{ host: 'http://localhost:8000', maxParallel: 32, apiKey: '' }]);
  });

  it('falls back to legacy single server', () => {
    const servers = resolveVllmServers({
      baseUrl: 'http://legacy:8000',
      apiKey: 'legacy-key',
      maxParallel: 2,
    });
    expect(servers).toEqual([{ host: 'http://legacy:8000', maxParallel: 2, apiKey: 'legacy-key' }]);
  });

  it('redacts api keys for API responses', () => {
    expect(
      redactVllmServerEntries([
        { host: 'http://a:8000', maxParallel: 2, apiKey: 'secret' },
        { host: 'http://b:8001', maxParallel: 1, apiKey: '' },
      ]),
    ).toEqual([
      { host: 'http://a:8000', maxParallel: 2, apiKeyConfigured: true },
      { host: 'http://b:8001', maxParallel: 1, apiKeyConfigured: false },
    ]);
  });

  it('keeps stored keys when the incoming key is blank', () => {
    expect(
      retainVllmApiKeys(
        [
          { host: 'http://a:8000', maxParallel: 4, apiKey: '' },
          { host: 'http://c:8002', maxParallel: 1, apiKey: '' },
        ],
        [
          { host: 'http://a:8000', maxParallel: 2, apiKey: 'kept' },
          { host: 'http://b:8001', maxParallel: 1, apiKey: 'dropped' },
        ],
      ),
    ).toEqual([
      { host: 'http://a:8000', maxParallel: 4, apiKey: 'kept' },
      { host: 'http://c:8002', maxParallel: 1, apiKey: '' },
    ]);
  });
});
