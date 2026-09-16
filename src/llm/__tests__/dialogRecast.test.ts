import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { ChatResult } from '../provider';
import type { LlmTranslateOptions } from '../translate';

const chatWithFallback = jest.fn<() => Promise<ChatResult>>();

jest.unstable_mockModule('../index', () => ({
  chatWithFallback,
}));

const {
  buildDialogRecastUserPayload,
  mergeDialogRecast,
  recastDialogTranslations,
  resolveDialogRecast,
} = await import('../dialogRecast');
const { FO4_UK_DIALOG_RECAST_PROMPT } =
  await import('../../games/creation-engine/prompts/fo4/recast');

const chatResult = (content: string, finishReason: 'stop' | 'length' = 'stop'): ChatResult => ({
  content,
  meta: {
    finishReason,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
  },
});

const baseOpts = (): LlmTranslateOptions => ({
  items: [
    {
      id: 1,
      source: 'I was surprised.',
      grup: 'INFO',
      edid: null,
      field: 'NAM1',
      form_id: null,
      context: null,
      speaker: 'Player',
      speaker_gender: 'any',
    },
    {
      id: 2,
      source: 'Are you ready?',
      grup: 'INFO',
      edid: null,
      field: 'NAM1',
      form_id: null,
      context: null,
      speaker: 'Preston',
      addressee: 'Player',
      addressee_gender: 'any',
    },
  ],
  model: 'test-model',
  srcLang: 'en',
  targetLang: 'uk',
  game: 'fo4',
  promptFamily: 'dialog',
});

describe('resolveDialogRecast', () => {
  it('runs only for the Fallout 4 Ukrainian dialogue pass', () => {
    expect(resolveDialogRecast({ ...baseOpts() })?.prompt).toBe(FO4_UK_DIALOG_RECAST_PROMPT);
    expect(resolveDialogRecast({ ...baseOpts(), targetLang: 'de' })).toBeNull();
    expect(resolveDialogRecast({ ...baseOpts(), promptFamily: 'item' })).toBeNull();
    expect(resolveDialogRecast({ ...baseOpts(), skipDialogRecast: true })).toBeNull();
  });

  it('is absent for a game that declares no recast pass', () => {
    expect(resolveDialogRecast({ ...baseOpts(), game: 'sse' })).toBeNull();
    expect(resolveDialogRecast({ ...baseOpts(), game: 'disco' })).toBeNull();
  });
});

describe('FO4_UK_DIALOG_RECAST_PROMPT', () => {
  it('shows how to recast gender instead of flipping masculine to feminine', () => {
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('спільний рядок Нейта і Нори');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('голосу мовця');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Не міняй чоловічий рід на жіночий');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('З тобою інакше');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Було приємно просто послухати');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Дякую за ці слова');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('чого я чекав/чекала');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Куди це ти?');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('єдина людина');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('дволична людина');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Ще не ясно, чи зможу');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Нічого з того, що скажеш');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Ви можете розправитися з тими гулями');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Я ціную ваші зусилля');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('ти вільна йти');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Словами мене не зупиниш');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Зробіть самі');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Зачекай. Скінні');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Що саме вам було потрібно');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Я вже давно на тебе чекаю');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Ще нікого не вдалося знайти');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Не вгадуй стать з імені');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('як зможеш');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Тобі вперед');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('робота зроблена');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Бережи себе.');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Будь обережною там. Будь обережним там.');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Будьте обережні');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).not.toContain('шкереберть');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Гаразд.');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Я згодна...');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('коли будеш готова.');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Я на місці, як зберешся.');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Ти що, вже не з нами?');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('готова» так само зламано');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Інститут уже звернув на тебе увагу');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('привернув увагу');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Знайте: майбутнє у надійних руках');
    expect(FO4_UK_DIALOG_RECAST_PROMPT).toContain('Май на увазі');
  });
});

describe('mergeDialogRecast', () => {
  it('keeps the draft when a recast id is missing or blank', () => {
    const draft = [
      { id: 1, translation: 'Я був здивований.' },
      { id: 2, translation: 'Ну що, рушаємо?' },
    ];
    expect(
      mergeDialogRecast(
        draft,
        new Map([
          [1, 'Мене це здивувало.'],
          [2, '   '],
        ]),
      ),
    ).toEqual([
      { id: 1, translation: 'Мене це здивувало.' },
      { id: 2, translation: 'Ну що, рушаємо?' },
    ]);
  });
});

describe('buildDialogRecastUserPayload', () => {
  it('sends the draft next to source and participants', () => {
    const payload = buildDialogRecastUserPayload(baseOpts(), [
      { id: 1, translation: 'Я був здивований.' },
      { id: 2, translation: 'Ти готовий?' },
    ]) as { items: Array<{ id: number; translation: string; speaker_gender?: string }> };
    expect(payload.items[0]).toMatchObject({
      id: 1,
      source: 'I was surprised.',
      translation: 'Я був здивований.',
      speaker_gender: 'any',
    });
    expect(payload.items[1]?.translation).toBe('Ти готовий?');
  });
});

describe('recastDialogTranslations', () => {
  beforeEach(() => {
    chatWithFallback.mockReset();
  });

  it('applies the editor pass', async () => {
    chatWithFallback.mockResolvedValue(
      chatResult(
        JSON.stringify({
          items: [
            { id: 1, translation: 'Мене це здивувало.' },
            { id: 2, translation: 'Ну що, рушаємо?' },
          ],
        }),
      ),
    );
    const result = await recastDialogTranslations(baseOpts(), [
      { id: 1, translation: 'Я був здивований.' },
      { id: 2, translation: 'Ти готовий?' },
    ]);
    expect(result).toEqual([
      { id: 1, translation: 'Мене це здивувало.' },
      { id: 2, translation: 'Ну що, рушаємо?' },
    ]);
    expect(chatWithFallback).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft when the editor call fails', async () => {
    chatWithFallback.mockRejectedValue(new Error('vLLM down'));
    const draft = [{ id: 1, translation: 'Я був здивований.' }];
    await expect(recastDialogTranslations(baseOpts(), draft)).resolves.toEqual(draft);
  });
});
