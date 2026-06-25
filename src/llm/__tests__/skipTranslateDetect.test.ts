import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { ChatResult } from '../provider';

const chatWithFallback = jest.fn<() => Promise<ChatResult>>();

const chatResult = (content: string): ChatResult => ({
  content,
  meta: {
    finishReason: 'stop',
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
  },
});

jest.unstable_mockModule('../index', () => ({
  chatWithFallback,
}));

const { detectSkipCandidatesWithLlm } = await import('../skipTranslateDetect');

describe('detectSkipCandidatesWithLlm', () => {
  beforeEach(() => {
    chatWithFallback.mockReset();
  });

  const baseOpts = {
    model: 'test-model',
    srcLang: 'en',
    targetLang: 'uk',
  };

  it('returns skip verdicts from valid JSON', async () => {
    chatWithFallback.mockResolvedValue(
      chatResult(
        JSON.stringify({
          items: [
            { id: 1, verdict: 'skip', reason: 'Markup only', confidence: 0.9 },
            { id: 2, verdict: 'keep', reason: 'Dialogue', confidence: 0.95 },
          ],
        }),
      ),
    );

    const results = await detectSkipCandidatesWithLlm({
      ...baseOpts,
      items: [
        {
          id: 1,
          source: '<Alias=x>',
          grup: 'INFO',
          edid: null,
          field: 'NAM1',
          path: null,
          context: null,
        },
        {
          id: 2,
          source: 'Hello',
          grup: 'INFO',
          edid: null,
          field: 'NAM1',
          path: null,
          context: null,
        },
      ],
    });

    expect(results).toEqual([
      expect.objectContaining({ id: 1, verdict: 'skip', reason: 'Markup only' }),
    ]);
    expect(chatWithFallback).toHaveBeenCalledTimes(1);
  });

  it('retries on invalid JSON then succeeds', async () => {
    jest.useFakeTimers();
    chatWithFallback
      .mockResolvedValueOnce(chatResult('not json'))
      .mockResolvedValueOnce(
        chatResult(
          JSON.stringify({ items: [{ id: 3, verdict: 'skip', reason: 'Code', confidence: 0.8 }] }),
        ),
      );

    const promise = detectSkipCandidatesWithLlm({
      ...baseOpts,
      items: [
        {
          id: 3,
          source: 'DEBUG_01',
          grup: 'GMST',
          edid: 'DEBUG_01',
          field: 'DATA',
          path: null,
          context: null,
        },
      ],
    });

    await jest.runAllTimersAsync();
    const results = await promise;

    expect(results).toHaveLength(1);
    expect(chatWithFallback).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('abandons batch after retries and returns partial results without throwing', async () => {
    jest.useFakeTimers();
    chatWithFallback.mockResolvedValue(chatResult('{{{invalid'));

    const promise = detectSkipCandidatesWithLlm({
      ...baseOpts,
      items: [
        {
          id: 4,
          source: 'Keep me',
          grup: 'INFO',
          edid: null,
          field: 'NAM1',
          path: null,
          context: null,
        },
        {
          id: 5,
          source: 'Also keep',
          grup: 'INFO',
          edid: null,
          field: 'NAM1',
          path: null,
          context: null,
        },
      ],
    });

    await jest.runAllTimersAsync();
    const results = await promise;

    expect(results).toEqual([]);
    expect(chatWithFallback.mock.calls.length).toBeGreaterThanOrEqual(1);
    jest.useRealTimers();
  });
});
