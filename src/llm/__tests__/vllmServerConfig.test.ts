import { describe, it, expect } from '@jest/globals';
import {
  parseVllmServersJson,
  resolveVllmServers,
  totalVllmChatParallel,
} from '../vllmServerConfig';

describe('vllmServerConfig', () => {
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
});
