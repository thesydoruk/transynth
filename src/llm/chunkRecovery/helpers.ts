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
