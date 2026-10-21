import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { disposeServicePools } from '../../services/pools';
import { syncServiceRegistryFromProjectSettings } from '../../services/registry';
import { resolveTtsBaseUrl } from '../../voice/voiceToolPaths';
import { ttsPipelineConcurrency, ttsPool } from '../ttsRequestPool';

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('ttsPool (tts service pool)', () => {
  beforeEach(() => disposeServicePools());
  afterEach(() => {
    syncServiceRegistryFromProjectSettings({});
    disposeServicePools();
  });

  it('serves the env TTS host with the project limit', async () => {
    syncServiceRegistryFromProjectSettings({ 'voice.tts_max_parallel_fish_speech': 3 });
    expect(ttsPool.maxParallel).toBe(3);
    expect(ttsPipelineConcurrency()).toBe(4);
    expect(ttsPool.stats.max).toBe(3);
    const host = await ttsPool.run(async (baseUrl) => baseUrl);
    expect(host).toBe(resolveTtsBaseUrl());
  });

  it('limits concurrent requests per host and spreads over configured hosts', async () => {
    syncServiceRegistryFromProjectSettings({
      'services.endpoints': [
        { kind: 'tts', host: 'http://tts-a:8080', maxParallel: 1 },
        { kind: 'tts', host: 'http://tts-b:8080', maxParallel: 1 },
      ],
    });
    let inFlight = 0;
    let max = 0;
    const hosts: string[] = [];
    const task = () =>
      ttsPool.run(async (baseUrl) => {
        hosts.push(baseUrl);
        inFlight++;
        max = Math.max(max, inFlight);
        await tick();
        inFlight--;
      });
    await Promise.all([task(), task(), task(), task()]);
    expect(max).toBeLessThanOrEqual(2);
    expect(new Set(hosts)).toEqual(new Set(['http://tts-a:8080', 'http://tts-b:8080']));
  });

  it('rebuilds when the project limit changes', () => {
    syncServiceRegistryFromProjectSettings({ 'voice.tts_max_parallel_fish_speech': 1 });
    expect(ttsPool.maxParallel).toBe(1);
    syncServiceRegistryFromProjectSettings({ 'voice.tts_max_parallel_fish_speech': 4 });
    expect(ttsPool.maxParallel).toBe(4);
  });
});
