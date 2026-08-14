import { CONFIG } from '../../config';
import { isDependencyUnavailableError } from '../../pipeline/errors';
import { isAbortError, isLlmTimeoutError } from '../retry';
import { isLlmSkipDetectMissingIdsError } from '../skipTranslateDetect';
import { isLlmTranslateMissingIdsError } from '../translate';
import { isLlmVerifyMissingIdsError } from '../verifyTranslate';
import { llmChatPipelineConcurrency } from '../requestPool';
import { mapWithConcurrency } from '../../utils/concurrency';
import { chunkBackoffMs, chunkItemId, isMissingTranslationChunkError } from './helpers';
import type { RunLlmChunkWithRecoveryOptions } from './types';

const splitChunkParallel = async <T>(
  opts: RunLlmChunkWithRecoveryOptions<T>,
  parts: readonly (readonly T[])[],
): Promise<void> => {
  if (parts.length === 0) return;
  if (opts.enqueueSplit) {
    opts.enqueueSplit(parts);
    return;
  }
  await mapWithConcurrency(parts, Math.min(parts.length, llmChatPipelineConcurrency()), (part) =>
    runLlmChunkWithRecovery({ ...opts, chunk: part, attempt: 0 }),
  );
};

/** Run one LLM batch with timeout split, bisect-on-error, and deferred backoff retry. */
export const runLlmChunkWithRecovery = async <T>(
  opts: RunLlmChunkWithRecoveryOptions<T>,
): Promise<void> => {
  const { chunk, runOnce, shouldAbort, onFailure, log, operation } = opts;
  const attempt = opts.attempt ?? 0;
  const maxAttempts = opts.maxAttempts ?? CONFIG.llmMaxAttempts;
  const itemIds = opts.itemIds ?? (() => []);

  if (chunk.length === 0) return;
  if (shouldAbort?.()) return;

  log.debug(`${operation} chunk flush`, {
    chunkSize: chunk.length,
    attempt: attempt + 1,
    itemIds: itemIds(chunk),
  });

  try {
    await runOnce(chunk, { enqueueSplit: opts.enqueueSplit ?? (() => {}) });
    return;
  } catch (err) {
    if (isDependencyUnavailableError(err)) throw err;
    if (shouldAbort?.() || isAbortError(err)) return;

    const message = err instanceof Error ? err.message : String(err);

    if (isLlmTimeoutError(err)) {
      if (chunk.length > 1) {
        log.warn(`${operation} chunk split to single rows (timeout)`, {
          reason: message,
          chunkSize: chunk.length,
          itemIds: itemIds(chunk),
        });
        await splitChunkParallel(
          opts,
          chunk.map((item) => [item]),
        );
        return;
      }
      log.error(`${operation} chunk failed (timeout)`, {
        error: message,
        itemIds: itemIds(chunk),
      });
      await onFailure(chunk, message);
      return;
    }

    if (
      (isLlmTranslateMissingIdsError(err) ||
        isLlmVerifyMissingIdsError(err) ||
        isLlmSkipDetectMissingIdsError(err)) &&
      chunk.length > 1
    ) {
      log.warn(`${operation} chunk split to single rows (missing LLM items)`, {
        reason: message,
        chunkSize: chunk.length,
        missingIds: err.missingIds,
        itemIds: itemIds(chunk),
      });
      const missingSet = new Set(err.missingIds);
      const missingParts = chunk.filter((item) => {
        const id = chunkItemId(item);
        return typeof id === 'number' && missingSet.has(id);
      });
      await splitChunkParallel(
        opts,
        missingParts.length > 0 ? missingParts.map((item) => [item]) : chunk.map((item) => [item]),
      );
      return;
    }

    if (isMissingTranslationChunkError(err) && chunk.length > 1) {
      log.warn(`${operation} chunk split to single rows (missing translation)`, {
        reason: message,
        chunkSize: chunk.length,
        itemIds: itemIds(chunk),
      });
      await splitChunkParallel(
        opts,
        chunk.map((item) => [item]),
      );
      return;
    }

    if (opts.shouldSplit?.(err) && chunk.length > 1) {
      const mid = Math.ceil(chunk.length / 2);
      log.warn(`${operation} chunk split`, {
        reason: message,
        chunkSize: chunk.length,
        firstHalf: itemIds(chunk.slice(0, mid)),
        secondHalf: itemIds(chunk.slice(mid)),
      });
      await splitChunkParallel(opts, [chunk.slice(0, mid), chunk.slice(mid)]);
      return;
    }

    if (attempt < maxAttempts - 1) {
      log.warn(`${operation} chunk retry scheduled`, {
        attempt: attempt + 1,
        maxAttempts,
        error: message,
        chunkSize: chunk.length,
        itemIds: itemIds(chunk),
      });
      if (opts.enqueueRetry) {
        opts.enqueueRetry(chunk, attempt + 1, chunkBackoffMs(attempt));
        return;
      }
      await new Promise((r) => setTimeout(r, chunkBackoffMs(attempt)));
      return runLlmChunkWithRecovery({ ...opts, attempt: attempt + 1 });
    }

    if (chunk.length > 1) {
      const mid = Math.ceil(chunk.length / 2);
      log.warn(`${operation} chunk split (final)`, {
        reason: message,
        chunkSize: chunk.length,
        firstHalf: itemIds(chunk.slice(0, mid)),
        secondHalf: itemIds(chunk.slice(mid)),
      });
      await splitChunkParallel(opts, [chunk.slice(0, mid), chunk.slice(mid)]);
      return;
    }

    log.error(`${operation} chunk failed`, {
      error: message,
      itemIds: itemIds(chunk),
    });
    await onFailure(chunk, message);
  }
};
