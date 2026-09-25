import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { ChatResult } from '../provider';
import type { LlmVerifyItem } from '../verifyTranslateTypes';

const chatWithFallback = jest.fn<(req: unknown) => Promise<ChatResult>>();

jest.unstable_mockModule('../index', () => ({ chatWithFallback }));

const { rewriteVerifyTranslationsFromSource } = await import('../verifySourceRewrite');

const chatResult = (content: string): ChatResult => ({
  content,
  meta: { finishReason: 'stop', promptTokens: null, completionTokens: null, totalTokens: null },
});

const item = (id: number, source: string, translation: string): LlmVerifyItem => ({
  id,
  source,
  translation,
  grup: 'BOOK',
  edid: `Note${id}`,
  field: 'DESC',
  context: null,
});

const opts = { model: 'test-model', srcLang: 'en', targetLang: 'uk', game: 'sse' };

beforeEach(() => {
  chatWithFallback.mockReset();
});

describe('rewriteVerifyTranslationsFromSource', () => {
  it('keeps the rows the model did translate when it skipped another', async () => {
    chatWithFallback.mockResolvedValue(
      chatResult('{"items":[{"id":1,"parts":["Двері зачинено."]}]}'),
    );
    const outcome = await rewriteVerifyTranslationsFromSource({
      ...opts,
      items: [
        item(1, 'The door is locked.', '{"id":1,"verdict":"ok"}'),
        item(2, 'A very long note nobody translates.', 'Стара нотатка.'),
      ],
    });
    expect(outcome.rewritten).toEqual([{ id: 1, text: 'Двері зачинено.' }]);
    expect(outcome.confirmedUnchanged).toEqual([]);
  });

  it('confirms a row whose re-translation matches what is already there', async () => {
    chatWithFallback.mockResolvedValue(
      chatResult('{"items":[{"id":1,"parts":["Двері зачинено."]}]}'),
    );
    const outcome = await rewriteVerifyTranslationsFromSource({
      ...opts,
      items: [item(1, 'The door is locked.', 'Двері зачинено.')],
    });
    expect(outcome.rewritten).toEqual([]);
    expect(outcome.confirmedUnchanged).toEqual([1]);
  });

  it('still fails the batch on an error that is not about missing rows', async () => {
    chatWithFallback.mockRejectedValue(new Error('LLM down'));
    await expect(
      rewriteVerifyTranslationsFromSource({
        ...opts,
        items: [item(1, 'The door is locked.', 'Старий текст.')],
      }),
    ).rejects.toThrow('LLM down');
  });
});
