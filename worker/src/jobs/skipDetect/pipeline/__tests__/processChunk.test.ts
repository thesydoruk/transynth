import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ChatResult } from '../../../../../../src/llm/provider';

/*
 * Which lines skip-detect marks "do not translate". A wrong "skip" hides real
 * player text from translators, so the cheap heuristics, the model and the
 * retry rules are tested together; only the chat call is replaced.
 */
type ModelItem = { id: number; source: string };
type Reply = (items: ModelItem[]) => object | Error;

let reply: Reply = () => ({ items: [] });
const chatWithFallback = jest.fn(async (req: { messages: Array<{ content: string }> }) => {
  const { items } = JSON.parse(req.messages.at(-1)!.content) as { items: ModelItem[] };
  const answer = reply(items);
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
// The worker asks the config for a model name; any name will do here.
const { CONFIG } = await import('../../../../../../src/config');
CONFIG.vllmModel ||= 'test-model';
// Two attempts keep the backoff between them to about a second.
CONFIG.llmMaxAttempts = 2;
const { processSkipDetectChunk } = await import('../processChunk');
type Row = import('../../types').ScanStringRow;

/** The model calls a line "skip" when its source starts with "Debug". */
const judge: Reply = (items) => ({
  items: items.map((item) =>
    item.source.startsWith('Debug')
      ? { id: item.id, verdict: 'skip', reason: 'Debug label', confidence: 0.95 }
      : { id: item.id, verdict: 'keep', reason: 'Player text', confidence: 0.9 },
  ),
});

const row = (string_id: number, source: string): Row => ({
  string_id,
  source,
  signature: 'MESG',
  path: String.raw`MESG\DESC`,
  edid: `Edid${string_id}`,
  context: null,
});

const opts = (useLlm = true) => ({ modId: 1, srcLang: 'en', game: 'fo4', useLlm });

describe('processSkipDetectChunk', () => {
  let splits: number[][][];
  const enqueueSplit = (parts: readonly (readonly Row[])[]) =>
    splits.push(parts.map((part) => part.map((r) => r.string_id)));

  beforeEach(() => {
    reply = judge;
    chatWithFallback.mockClear();
    splits = [];
  });

  const ids = (hits: Array<{ stringId: number }>) => hits.map((hit) => hit.stringId).sort();

  it('marks markup-only and number-only lines without asking the model', async () => {
    const hits = await processSkipDetectChunk(
      [row(1, '<Alias=Player>'), row(2, '+15%')],
      opts(),
      enqueueSplit,
    );

    expect(hits.map((hit) => [hit.stringId, hit.method])).toEqual([
      [1, 'heuristic'],
      [2, 'heuristic'],
    ]);
    expect(chatWithFallback).not.toHaveBeenCalled();
  });

  it('asks the model only about the lines the heuristics left, and keeps its "keep"s', async () => {
    const hits = await processSkipDetectChunk(
      [row(1, '+15%'), row(2, 'Debug: spawn raiders'), row(3, 'Take the fusion core to Sturges.')],
      opts(),
      enqueueSplit,
    );

    expect(ids(hits)).toEqual([1, 2]);
    expect(hits.find((hit) => hit.stringId === 2)).toMatchObject({
      method: 'llm',
      confidence: 0.95,
    });
    const asked = JSON.parse(chatWithFallback.mock.calls[0]![0].messages.at(-1)!.content).items;
    expect(asked.map((item: ModelItem) => item.id)).toEqual([2, 3]);
  });

  it('uses the heuristics alone when the model is not wanted', async () => {
    const hits = await processSkipDetectChunk(
      [row(1, '+15%'), row(2, 'Debug: spawn raiders')],
      opts(false),
      enqueueSplit,
    );

    expect(ids(hits)).toEqual([1]);
    expect(chatWithFallback).not.toHaveBeenCalled();
  });

  it('keeps the verdicts that came back and retries each missing line on its own', async () => {
    reply = (items) => judge(items.filter((item) => item.id !== 2));

    const hits = await processSkipDetectChunk(
      [row(1, 'Debug: one'), row(2, 'Debug: two'), row(3, 'Hello')],
      opts(),
      enqueueSplit,
    );

    expect(ids(hits)).toEqual([1]);
    expect(splits).toEqual([[[2]]]);
  });

  it('retries a timed-out batch in halves', async () => {
    reply = () =>
      Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });

    const hits = await processSkipDetectChunk(
      [row(1, 'Debug: one'), row(2, 'Hello'), row(3, 'Debug: three'), row(4, 'Bye')],
      opts(),
      enqueueSplit,
    );

    expect(hits).toEqual([]);
    expect(splits).toEqual([
      [
        [1, 2],
        [3, 4],
      ],
    ]);
  });

  it('retries a failing model call, then marks nothing rather than guessing', async () => {
    reply = () => new Error('502 Bad Gateway');

    const hits = await processSkipDetectChunk(
      [row(1, 'Debug: one'), row(2, 'Hello')],
      opts(),
      enqueueSplit,
    );

    expect(hits).toEqual([]);
    expect(chatWithFallback).toHaveBeenCalledTimes(2);
  });

  it('does not call the model once the job is cancelled', async () => {
    const hits = await processSkipDetectChunk(
      [row(1, 'Debug: one')],
      { ...opts(), shouldCancel: () => true },
      enqueueSplit,
    );

    expect(hits).toEqual([]);
    expect(chatWithFallback).not.toHaveBeenCalled();
  });
});
