import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { checkTtsHealth, probeTtsHealth } from '../ttsHealth';

describe('ttsHealth', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('treats HTTP failure as unhealthy without throwing', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503 } as Response);
    await expect(probeTtsHealth('http://tts:8080')).resolves.toEqual({
      ok: false,
      error: 'TTS health check failed (http://tts:8080/health)',
    });
  });

  it('treats model_ready=false as unhealthy', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'loading', model_ready: false }),
    } as Response);
    await expect(probeTtsHealth('http://tts:8080')).resolves.toEqual({
      ok: false,
      error: 'TTS is not ready (status=loading)',
    });
  });

  it('checkTtsHealth throws the probe error', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503 } as Response);
    await expect(checkTtsHealth('http://tts:8080')).rejects.toThrow('TTS health check failed');
  });
});
