import { buildLlmTranslateChunks } from '../llmTranslateChunking';

const item = (id: number, len: number) => ({
  id,
  sourceText: 'x'.repeat(len),
});

describe('buildLlmTranslateChunks', () => {
  const opts = { batchSize: 3, maxSourceChars: 100, singleRowMaxSourceChars: 500 };

  it('groups by batch size', () => {
    const chunks = buildLlmTranslateChunks(
      [item(1, 10), item(2, 10), item(3, 10), item(4, 10)],
      opts,
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(chunks[1]?.map((r) => r.id)).toEqual([4]);
  });

  it('flushes when combined source chars exceed limit', () => {
    const chunks = buildLlmTranslateChunks([item(1, 60), item(2, 60), item(3, 10)], opts);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.map((r) => r.id)).toEqual([1, 2]);
    expect(chunks[1]?.map((r) => r.id)).toEqual([3]);
  });

  it('isolates rows longer than singleRowMaxSourceChars', () => {
    const chunks = buildLlmTranslateChunks(
      [item(1, 10), item(2, 501), item(3, 10), item(4, 10)],
      opts,
    );
    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.map((r) => r.id)).toEqual([1]);
    expect(chunks[1]?.map((r) => r.id)).toEqual([2]);
    expect(chunks[2]?.map((r) => r.id)).toEqual([3, 4]);
  });

  it('flushes pending buffer before a long row', () => {
    const chunks = buildLlmTranslateChunks(
      [item(1, 10), item(2, 10), item(3, 600), item(4, 10)],
      opts,
    );
    expect(chunks.map((c) => c.map((r) => r.id))).toEqual([[1, 2], [3], [4]]);
  });
});
