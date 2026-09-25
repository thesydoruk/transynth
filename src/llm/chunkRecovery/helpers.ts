import { isLlmSkipDetectMissingIdsError } from '../skipTranslateDetect';
import { isLlmTranslateMissingIdsError } from '../translate';
import { isLlmVerifyMissingIdsError } from '../verifyTranslate';

/** Re-queue each item as its own chunk (shared by translate, verify, skip-detect). */
export const enqueueSoloChunks = <T>(
  items: readonly T[],
  enqueueSplit: (parts: readonly (readonly T[])[]) => void,
): void => {
  for (const item of items) {
    enqueueSplit([[item]]);
  }
};

/** The two halves of a chunk, for a retry that keeps most of the batching. */
export const bisectChunk = <T>(items: readonly T[]): readonly (readonly T[])[] => {
  if (items.length <= 1) return [items];
  const mid = Math.ceil(items.length / 2);
  return [items.slice(0, mid), items.slice(mid)];
};

/**
 * Re-queue a chunk that timed out as two halves rather than as single rows.
 *
 * A timeout means the server is saturated, and a batch of 25 exploded into 25
 * requests — each carrying the same ten-thousand-token system prompt — is the
 * worst possible reply to that: on the production host one such cascade was
 * 204 batch timeouts turned into thousands of solo calls that timed out in
 * their turn. Halving keeps the batching, halves the output the server has to
 * produce per request, and reaches single rows only for a row that genuinely
 * cannot finish in time.
 */
export const enqueueBisected = <T>(
  items: readonly T[],
  enqueueSplit: (parts: readonly (readonly T[])[]) => void,
): void => {
  enqueueSplit(bisectChunk(items));
};

export const chunkItemId = (item: unknown): number | undefined => {
  const row = item as { stringId?: number; string_id?: number; id?: number };
  return row.stringId ?? row.string_id ?? row.id;
};

export const chunkBackoffMs = (attempt: number): number =>
  Math.min(1000 * Math.pow(2, attempt) + Math.random() * 300, 30_000);

export const isMissingTranslationChunkError = (err: unknown): boolean =>
  isLlmTranslateMissingIdsError(err) ||
  isLlmVerifyMissingIdsError(err) ||
  isLlmSkipDetectMissingIdsError(err) ||
  (err instanceof Error &&
    /LLM (?:response missing translation|verify response missing item) for id=\d+/.test(
      err.message,
    ));
