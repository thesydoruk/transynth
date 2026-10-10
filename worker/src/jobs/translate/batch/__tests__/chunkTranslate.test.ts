import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ChatResult } from '../../../../../../src/llm/provider';

/*
 * The model is replaced at the chat call, below `translateStrings`: the real
 * request is built, the real response parser runs and throws the real errors,
 * so what is tested is how a chunk reacts to each kind of answer.
 */
type ModelItem = { id: number; parts?: Array<string | number>; source?: string };
type Reply = (items: ModelItem[]) => object | Error;

let reply: Reply = () => ({ items: [] });
const chatWithFallback = jest.fn(async (req: { messages: Array<{ content: string }> }) => {
  const payload = JSON.parse(req.messages.at(-1)!.content) as { items?: ModelItem[] };
  if (!payload.items) throw new Error('unexpected model call without items');
  const answer = reply(payload.items);
  if (answer instanceof Error) throw answer;
  return {
    content: JSON.stringify(answer),
    meta: { finishReason: 'stop', promptTokens: null, completionTokens: null, totalTokens: null },
  } satisfies ChatResult;
});
jest.unstable_mockModule('../../../../../../src/llm/index', () => ({
  chatWithFallback,
  resolveLlmChatTemperature: () => 0,
  embedWithFallback: async () => {
    throw new Error('no embeddings in this test');
  },
}));

await import('../../../../../../src/games');
const { translateChunkOnce, chunkWorkPoolShouldSplit, drainPersistJobs } =
  await import('../chunkTranslate');
const { prepareLlmItems } = await import('../prepareRows');
const { Semaphore } = await import('../../../../../../src/utils/concurrency');
type ChunkCtx = import('../types').ChunkTranslateContext;
type Prepared = import('../types').PreparedLlmItem;
type StringRow = import('../types').StringRow;
type Result = import('../types').TranslateBatchResult;

/** A word-by-word "translation" that keeps every slot where it was. */
const DICTIONARY: Record<string, string> = {
  Sturges: 'Стерджес',
  'Preston Garvey': 'Престон Ґарві',
  'Take ': 'Відведи ',
  ' home, ': ' додому, ',
  ' caps.': ' кришок.',
};
const translatePart = (part: string | number) =>
  typeof part === 'number' ? part : (DICTIONARY[part] ?? `[${part}]`);
const goodModel: Reply = (items) => ({
  items: items.map((item) => ({ id: item.id, parts: item.parts!.map(translatePart) })),
});

const row = (id: number, text: string): StringRow =>
  ({
    id,
    text_raw: text,
    text_norm: text,
    text_norm_nopunct: text,
    context: null,
    signature: 'MESG',
    path: String.raw`MESG\DESC`,
    edid: `Edid${id}`,
    formid_hex: `0000000${id}`,
    game: 'fo4',
    mod_name: 'Test Mod',
    narrator_gender: null,
    speaker_key: null,
    speaker_name: null,
    speaker_gender: null,
    speaker_is_player: null,
    addressee_kind: null,
    addressee_name: null,
    addressee_gender: null,
  }) as StringRow;

/** The same preparation the worker runs: masking, slots, participants. */
const prepare = (texts: string[]): Prepared[] => {
  const rows = texts.map((text, i) => row(i + 1, text));
  return prepareLlmItems(
    rows.map((r) => r.id),
    new Map(rows.map((r) => [r.id, r])),
    { modGame: 'fo4' },
    () => {},
  ).llmPending;
};

describe('translateChunkOnce', () => {
  let results: Result[];
  let persisted: Array<{ stringId: number; text: string }>;
  let splits: number[][][];
  let persistFails: boolean;
  let ctx: ChunkCtx;

  beforeEach(() => {
    reply = goodModel;
    chatWithFallback.mockClear();
    results = [];
    persisted = [];
    splits = [];
    persistFails = false;
    ctx = {
      db: {} as ChunkCtx['db'],
      opts: { srcLang: 'en', targetLang: 'uk', modGame: 'fo4', modName: 'Test Mod' },
      rag: { disableRag: true },
      ragMaxExamples: 0,
      ragMinSimilarity: 0,
      glossaryAll: [],
      model: 'test-model',
      emitResult: (result) => results.push(result),
      persistPool: new Semaphore(2),
      persistJobs: [],
      persistAutoTranslationRows: async (rows) => {
        if (persistFails) throw new Error('connection reset');
        persisted.push(...rows);
      },
    };
  });

  const run = async (chunk: Prepared[]) => {
    await translateChunkOnce(ctx, chunk, new Map(), (parts) =>
      splits.push(parts.map((part) => part.map((entry) => entry.stringId))),
    );
    await drainPersistJobs(ctx.persistJobs);
  };

  it('writes every row and puts the placeholders back', async () => {
    await run(prepare(['Sturges', 'Take <Alias=Player> home, %d caps.']));

    expect(persisted).toEqual([
      { stringId: 1, text: 'Стерджес' },
      { stringId: 2, text: 'Відведи <Alias=Player> додому, %d кришок.' },
    ]);
    expect(results.filter((r) => r.error)).toEqual([]);
    expect(chatWithFallback).toHaveBeenCalledTimes(1);
  });

  it('retries on its own a row whose parts dropped a placeholder slot', async () => {
    reply = (items) => ({
      items: items.map((item) => ({
        id: item.id,
        parts: item.parts!.filter((part) => part !== 0).map(translatePart),
      })),
    });

    await run(prepare(['Sturges', 'Take <Alias=Player> home, %d caps.']));

    expect(persisted).toEqual([{ stringId: 1, text: 'Стерджес' }]);
    expect(splits).toEqual([[[2]]]);
  });

  it('refuses a plain-text answer that lost a placeholder, and keeps the rest', async () => {
    reply = (items) => ({
      items: items.map((item) =>
        item.id === 2
          ? { id: 2, translation: 'Відведи гравця додому.' }
          : { id: item.id, parts: item.parts!.map(translatePart) },
      ),
    });

    await run(prepare(['Sturges', 'Take <Alias=Player> home, %d caps.']));

    expect(persisted).toEqual([{ stringId: 1, text: 'Стерджес' }]);
    expect(results).toContainEqual(
      expect.objectContaining({ stringId: 2, error: expect.any(String) }),
    );
  });

  it('keeps what came back and retries each missing row on its own', async () => {
    reply = (items) => goodModel(items.filter((item) => item.id !== 2));

    await run(prepare(['Sturges', 'Preston Garvey', 'Take <Alias=Player> home, %d caps.']));

    expect(persisted.map((r) => r.stringId)).toEqual([1, 3]);
    expect(splits).toEqual([[[2]]]);
  });

  it('treats a blank translation as missing, not as a translation', async () => {
    reply = (items) => ({
      items: items.map((item) => ({
        id: item.id,
        parts: item.id === 2 ? [' '] : item.parts!.map(translatePart),
      })),
    });

    await run(prepare(['Sturges', 'Preston Garvey']));

    expect(persisted.map((r) => r.stringId)).toEqual([1]);
    expect(splits).toEqual([[[2]]]);
  });

  it('lets a single missing row fail, so the pool can give up on it', async () => {
    reply = () => ({ items: [] });

    await expect(run(prepare(['Sturges']))).rejects.toThrow(/missing translation/);
    expect(persisted).toEqual([]);
  });

  it('retries a timed-out batch in halves, not one request per row', async () => {
    reply = () =>
      Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });

    await run(
      prepare(['Sturges', 'Preston Garvey', 'Take <Alias=Player> home, %d caps.', 'Sturges']),
    );

    expect(splits).toEqual([
      [
        [1, 2],
        [3, 4],
      ],
    ]);
    expect(persisted).toEqual([]);
  });

  it('lets a single timed-out row fail', async () => {
    reply = () =>
      Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });

    await expect(run(prepare(['Sturges']))).rejects.toThrow(/timed out/);
    expect(splits).toEqual([]);
  });

  it('does not split on an error that a smaller batch would not fix', async () => {
    reply = () => new Error('401 Unauthorized');

    await expect(run(prepare(['Sturges', 'Preston Garvey']))).rejects.toThrow(/401/);
    expect(splits).toEqual([]);
  });

  it('reports every row of a chunk the database refused', async () => {
    persistFails = true;

    await run(prepare(['Sturges', 'Preston Garvey']));

    expect(results).toEqual([
      { stringId: 1, error: 'persist failed: connection reset' },
      { stringId: 2, error: 'persist failed: connection reset' },
    ]);
  });
});

describe('chunkWorkPoolShouldSplit', () => {
  it('splits on truncation, missing ids and timeouts only', async () => {
    const { LlmResponseTruncatedError, LlmTranslateMissingIdsError } =
      await import('../../../../../../src/llm/translate');
    expect(chunkWorkPoolShouldSplit(new LlmResponseTruncatedError('cut'))).toBe(true);
    expect(chunkWorkPoolShouldSplit(new LlmTranslateMissingIdsError([1], []))).toBe(true);
    expect(chunkWorkPoolShouldSplit(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toBe(
      true,
    );
    expect(chunkWorkPoolShouldSplit(new Error('401 Unauthorized'))).toBe(false);
  });
});
