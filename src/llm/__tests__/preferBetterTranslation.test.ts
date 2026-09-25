import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { ChatResult } from '../provider';
import type { LlmVerifyItem } from '../verifyTranslateTypes';

const chatWithFallback = jest.fn<(req: unknown) => Promise<ChatResult>>();

jest.unstable_mockModule('../index', () => ({ chatWithFallback }));

const { preferBetterTranslations } = await import('../preferBetterTranslation');

const chatResult = (content: string): ChatResult => ({
  content,
  meta: { finishReason: 'stop', promptTokens: null, completionTokens: null, totalTokens: null },
});

const item = (id: number): LlmVerifyItem => ({
  id,
  source: 'Are you ready?',
  translation: 'Ти готовий?',
  grup: 'INFO',
  edid: 'TestLine',
  field: 'NAM1',
  context: null,
});

const rows = (ids: number[]) => ids.map((id) => ({ item: item(id), candidate: 'Ну що, рушаємо?' }));

const opts = { model: 'test-model', srcLang: 'en', targetLang: 'uk', game: 'fo4' };

beforeEach(() => {
  chatWithFallback.mockReset();
});

describe('preferBetterTranslations', () => {
  it('asks nothing when there is nothing to compare', async () => {
    const winners = await preferBetterTranslations([], opts);
    expect(winners.size).toBe(0);
    expect(chatWithFallback).not.toHaveBeenCalled();
  });

  it('keeps a candidate the model picked', async () => {
    chatWithFallback.mockResolvedValue(
      chatResult('{"items":[{"id":1,"choice":"candidate"}]}') as never,
    );
    expect([...(await preferBetterTranslations(rows([1]), opts))]).toEqual([1]);
  });

  it('drops a candidate when the current translation wins', async () => {
    chatWithFallback.mockResolvedValue(
      chatResult('{"items":[{"id":1,"choice":"current"}]}') as never,
    );
    expect((await preferBetterTranslations(rows([1]), opts)).size).toBe(0);
  });

  it('leaves a row alone when the model said nothing about it', async () => {
    chatWithFallback.mockResolvedValue(
      chatResult('{"items":[{"id":1,"choice":"candidate"}]}') as never,
    );
    const winners = await preferBetterTranslations(rows([1, 2]), opts);
    expect([...winners]).toEqual([1]);
  });

  it('sends both wordings and the source for each row', async () => {
    chatWithFallback.mockResolvedValue(chatResult('{"items":[]}') as never);
    await preferBetterTranslations(rows([1]), opts);
    const call = chatWithFallback.mock.calls[0]![0] as {
      messages: Array<{ content: string }>;
    };
    const payload = JSON.parse(call.messages[1]!.content) as {
      items: Array<{ source: string; current: string; candidate: string }>;
    };
    expect(payload.items[0]).toMatchObject({
      source: 'Are you ready?',
      current: 'Ти готовий?',
      candidate: 'Ну що, рушаємо?',
    });
  });

  it('keeps the current translations when the comparison call fails', async () => {
    chatWithFallback.mockRejectedValue(new Error('LLM down') as never);
    const winners = await preferBetterTranslations(rows([1, 2]), opts);
    expect(winners.size).toBe(0);
  });

  it('keeps the current translations when the answer is unusable', async () => {
    chatWithFallback.mockResolvedValue(chatResult('not json at all') as never);
    const winners = await preferBetterTranslations(rows([1, 2]), opts);
    expect(winners.size).toBe(0);
  });
});
