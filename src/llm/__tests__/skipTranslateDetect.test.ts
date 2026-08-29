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

const { detectSkipCandidatesWithLlm, LlmSkipDetectMissingIdsError, buildSkipDetectUserPayload } =
  await import('../skipTranslateDetect');

describe('buildSkipDetectUserPayload', () => {
  it('masks source and context placeholders', () => {
    const payload = buildSkipDetectUserPayload({
      srcLang: 'en',
      items: [
        {
          id: 1,
          source: '<Alias=Player> entered',
          context: 'RegisterForAnimationEvent("Idle")',
          grup: 'INFO',
          edid: null,
          field: 'NAM1',
          path: null,
        },
      ],
    }) as { items: Array<{ source: string; context: string | null }> };

    expect(payload.items[0]?.source).toBe('¤PH0¤ entered');
    expect(payload.items[0]?.context).toBe('RegisterForAnimationEvent("Idle")');
  });
});

describe('detectSkipCandidatesWithLlm', () => {
  beforeEach(() => {
    chatWithFallback.mockReset();
  });

  const baseOpts = {
    model: 'test-model',
    srcLang: 'en',
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

  it('throws on invalid JSON', async () => {
    chatWithFallback.mockResolvedValue(chatResult('not json'));

    await expect(
      detectSkipCandidatesWithLlm({
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
      }),
    ).rejects.toThrow();
    expect(chatWithFallback).toHaveBeenCalledTimes(1);
  });

  it('throws LlmSkipDetectMissingIdsError when some ids are missing', async () => {
    chatWithFallback.mockResolvedValue(
      chatResult(
        JSON.stringify({
          items: [{ id: 4, verdict: 'skip', reason: 'Code', confidence: 0.8 }],
        }),
      ),
    );

    await expect(
      detectSkipCandidatesWithLlm({
        ...baseOpts,
        items: [
          {
            id: 4,
            source: 'DEBUG_01',
            grup: 'GMST',
            edid: 'DEBUG_01',
            field: 'DATA',
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
      }),
    ).rejects.toMatchObject({
      name: 'LlmSkipDetectMissingIdsError',
      missingIds: [5],
      partialResults: [expect.objectContaining({ id: 4, verdict: 'skip' })],
    });
    expect(chatWithFallback).toHaveBeenCalledTimes(1);
  });

  it('LlmSkipDetectMissingIdsError carries partial skip hits', () => {
    const err = new LlmSkipDetectMissingIdsError(
      [5],
      [{ id: 4, verdict: 'skip', reason: 'Code', confidence: 0.8 }],
    );
    expect(err.partialResults).toHaveLength(1);
    expect(err.missingIds).toEqual([5]);
  });
});
