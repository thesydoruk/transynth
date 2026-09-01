import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { checkAudioIntelHealth, probeAudioIntelHealth } from '../health';

describe('audio-intel health', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('treats HTTP failure as unhealthy without throwing', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503 } as Response);
    await expect(probeAudioIntelHealth('http://ai:8080')).resolves.toEqual({
      ok: false,
      error: 'audio-intel health check failed (http://ai:8080/health)',
    });
  });

  it('accepts status ok', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', model: 'large-v3' }),
    } as Response);
    await expect(probeAudioIntelHealth('http://ai:8080')).resolves.toEqual({ ok: true });
  });

  it('checkAudioIntelHealth throws the probe error', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503 } as Response);
    await expect(checkAudioIntelHealth('http://ai:8080')).rejects.toThrow(
      'audio-intel health check failed',
    );
  });
});
