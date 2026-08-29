/** Item with source length used for LLM batch chunking. */
export type LlmChunkSourceItem = { sourceText: string };

export type BuildLlmTranslateChunksOptions = {
  batchSize: number;
  maxSourceChars: number;
  /** Rows longer than this are sent in a solo LLM request (default 500). */
  singleRowMaxSourceChars: number;
};

/**
 * Group strings into LLM batches by count and combined source length.
 * Any row longer than {@link BuildLlmTranslateChunksOptions.singleRowMaxSourceChars}
 * is always placed in its own chunk.
 */
export const buildLlmTranslateChunks = <T extends LlmChunkSourceItem>(
  items: T[],
  opts: BuildLlmTranslateChunksOptions,
): T[][] => {
  const chunks: T[][] = [];
  let buffer: T[] = [];
  let bufferSourceChars = 0;

  const flush = (): void => {
    if (buffer.length === 0) return;
    chunks.push(buffer);
    buffer = [];
    bufferSourceChars = 0;
  };

  for (const item of items) {
    if (item.sourceText.length > opts.singleRowMaxSourceChars) {
      flush();
      chunks.push([item]);
      continue;
    }

    buffer.push(item);
    bufferSourceChars += item.sourceText.length;
    if (buffer.length >= opts.batchSize || bufferSourceChars >= opts.maxSourceChars) {
      flush();
    }
  }

  flush();
  return chunks;
};
