import { describe, expect, it } from '@jest/globals';
import { normalizeServiceEndpoints, redactServiceEndpoints, retainServiceApiKeys } from '../kinds';
import { ServiceRegistry } from '../registry';

const env = normalizeServiceEndpoints([
  { kind: 'llm', host: 'http://env-llm:8000', maxParallel: 2 },
  { kind: 'embed', host: 'http://env-embed:8013', maxParallel: 4 },
  { kind: 'tts', host: 'http://env-tts:8080', maxParallel: 1 },
  { kind: 'asr', host: 'http://env-asr:8080', maxParallel: 2 },
]);

describe('normalizeServiceEndpoints', () => {
  it('keeps valid rows, drops unknown kinds and non-http hosts, clamps limits', () => {
    const rows = normalizeServiceEndpoints([
      { kind: 'tts', url: 'http://a:1/', max_parallel: 99, api_key: 'k' },
      { kind: 'nope', host: 'http://b:1' },
      { kind: 'asr', host: 'ftp://c' },
      { kind: 'tools', host: 'http://d:2', managed: true },
      'garbage',
    ]);
    expect(rows).toEqual([
      { kind: 'tts', host: 'http://a:1', maxParallel: 32, apiKey: 'k', managed: false },
      { kind: 'tools', host: 'http://d:2', maxParallel: 1, apiKey: '', managed: true },
    ]);
  });

  it('redacts keys and retains stored keys for blank incoming ones', () => {
    const stored = normalizeServiceEndpoints([{ kind: 'llm', host: 'http://x', apiKey: 'secret' }]);
    const incoming = normalizeServiceEndpoints([
      { kind: 'llm', host: 'http://x', apiKey: '' },
      { kind: 'llm', host: 'http://y', apiKey: 'new' },
    ]);
    expect(retainServiceApiKeys(incoming, stored).map((e) => e.apiKey)).toEqual(['secret', 'new']);
    expect(redactServiceEndpoints(stored)[0]).toEqual({
      kind: 'llm',
      host: 'http://x',
      maxParallel: 1,
      managed: false,
      apiKeyConfigured: true,
    });
  });
});

describe('ServiceRegistry', () => {
  it('resolves settings over legacy llm over env, and separate from asr', () => {
    const registry = new ServiceRegistry({ configured: [], legacyLlm: [], env });
    expect(registry.endpoints('llm').map((e) => e.host)).toEqual(['http://env-llm:8000']);
    expect(registry.sourceOf('llm')).toBe('env');
    expect(registry.endpoints('separate')).toEqual([
      { ...env.find((e) => e.kind === 'asr')!, kind: 'separate', maxParallel: 1 },
    ]);
    expect(registry.sourceOf('separate')).toBe('asr');
    expect(registry.endpoints('tools')).toEqual([]);

    registry.update({ legacyLlm: [{ host: 'http://legacy:8000', maxParallel: 3, apiKey: 'k' }] });
    expect(registry.endpoints('llm')).toEqual([
      { kind: 'llm', host: 'http://legacy:8000', maxParallel: 3, apiKey: 'k', managed: false },
    ]);
    expect(registry.sourceOf('llm')).toBe('legacy-llm');

    registry.update({
      configured: normalizeServiceEndpoints([
        { kind: 'llm', host: 'http://set-llm:8000', maxParallel: 8 },
        { kind: 'separate', host: 'http://sep:8080', maxParallel: 2 },
      ]),
    });
    expect(registry.endpoints('llm').map((e) => e.host)).toEqual(['http://set-llm:8000']);
    expect(registry.sourceOf('llm')).toBe('settings');
    expect(registry.endpoints('separate').map((e) => e.host)).toEqual(['http://sep:8080']);
    expect(registry.endpoints('tts').map((e) => e.host)).toEqual(['http://env-tts:8080']);
  });

  it('notifies listeners only for kinds whose endpoints changed', () => {
    const registry = new ServiceRegistry({ configured: [], legacyLlm: [], env });
    const changed: string[] = [];
    registry.onChange((kind) => changed.push(kind));
    registry.update({
      configured: normalizeServiceEndpoints([{ kind: 'tts', host: 'http://new-tts:1' }]),
    });
    expect(changed).toEqual(['tts']);
    changed.length = 0;
    registry.update({ env });
    expect(changed).toEqual([]);
  });
});

describe('ServiceRegistry managed rows', () => {
  it('adds managed rows to the env or legacy rows instead of replacing them', () => {
    const registry = new ServiceRegistry({
      configured: [
        { kind: 'llm', host: 'http://gpu5090:8011', maxParallel: 4, apiKey: '', managed: true },
        { kind: 'tools', host: 'http://gpu5090:3210', maxParallel: 8, apiKey: '', managed: true },
      ],
      legacyLlm: [{ host: 'http://pipeline:8011', maxParallel: 8, apiKey: '' }],
      env: [
        {
          kind: 'tools',
          host: 'http://bethesda-tools:3210',
          maxParallel: 8,
          apiKey: '',
          managed: false,
        },
      ],
    });
    expect(registry.endpoints('llm').map((e) => e.host)).toEqual([
      'http://pipeline:8011',
      'http://gpu5090:8011',
    ]);
    expect(registry.endpoints('tools').map((e) => e.host)).toEqual([
      'http://bethesda-tools:3210',
      'http://gpu5090:3210',
    ]);
    expect(registry.sourceOf('llm')).toBe('legacy-llm');
    expect(registry.sourceOf('tools')).toBe('env');
  });

  it('lets a managed row replace a hand-written row for the same host', () => {
    const registry = new ServiceRegistry({
      configured: [
        { kind: 'tts', host: 'http://fish:8080', maxParallel: 20, apiKey: '', managed: false },
        { kind: 'tts', host: 'http://fish:8080', maxParallel: 2, apiKey: '', managed: true },
      ],
      legacyLlm: [],
      env: [],
    });
    expect(registry.endpoints('tts')).toEqual([
      { kind: 'tts', host: 'http://fish:8080', maxParallel: 2, apiKey: '', managed: true },
    ]);
    expect(registry.sourceOf('tts')).toBe('settings');
  });
});
