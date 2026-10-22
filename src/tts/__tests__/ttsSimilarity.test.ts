import { describe, expect, it, jest } from '@jest/globals';
import { parseSimilarityResponse, scoreVoiceSimilarity } from '../ttsSimilarity';

describe('parseSimilarityResponse', () => {
  it('reads a finite number and nothing else', () => {
    expect(parseSimilarityResponse({ voice_similarity: 0.412 })).toBe(0.412);
    expect(parseSimilarityResponse({ voice_similarity: null })).toBeNull();
    expect(parseSimilarityResponse({ voice_similarity: 'high' })).toBeNull();
    expect(parseSimilarityResponse(undefined)).toBeNull();
  });
});

describe('scoreVoiceSimilarity', () => {
  it('posts the take and every reference clip to /v1/similarity', async () => {
    const calls: Array<{ url: string; names: string[] }> = [];
    const fetchMock = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      calls.push({ url: String(url), names: [...form.keys()] });
      return new Response(JSON.stringify({ voice_similarity: 0.5 }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const value = await scoreVoiceSimilarity('http://tts/', Buffer.from('take'), [
        { wav: Buffer.from('a') },
        { wav: Buffer.from('b') },
      ]);
      expect(value).toBe(0.5);
      expect(calls).toEqual([
        { url: 'http://tts/v1/similarity', names: ['audio', 'speaker_wav', 'speaker_wav'] },
      ]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('rejects an empty reference list before calling the gateway', async () => {
    await expect(scoreVoiceSimilarity('http://tts', Buffer.from('x'), [])).rejects.toThrow(
      'Reference audio is empty',
    );
  });
});
