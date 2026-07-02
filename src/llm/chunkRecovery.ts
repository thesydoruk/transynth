/**
 * Retry / split recovery for batched LLM HTTP calls (translate, verify, skip-detect).
 *
 * On timeout, splits to parallel single-row requests so one slow row does not block
 * siblings in the same HTTP batch. On other transient errors, retries with backoff
 * then bisects in parallel.
 */
import { CONFIG } from '../config';
import { isAbortError, isLlmTimeoutError } from './retry';
import { llmChatPipelineConcurrency } from './requestPool';
import { mapWithConcurrency } from '../utils/concurrency';
import type { Logger } from '../logger';

export type ChunkRecoveryLogger = Pick<Logger, 'warn' | 'error' | 'debug'>;

export type RunLlmChunkWithRecoveryOptions<T> = {
  chunk: readonly T[];
  runOnce: (chunk: readonly T[]) => Promise<void>;
  shouldAbort?: () => boolean;
  maxAttempts?: number;
  /** When true for an error and chunk.length > 1, bisect and retry each half. */
  shouldSplit?: (err: unknown) => boolean;
  onFailure: (failed: readonly T[], message: string) => void | Promise<void>;
  log: ChunkRecoveryLogger;
  operation: string;
  itemIds?: (chunk: readonly T[]) => unknown[];
};

const chunkBackoffMs = (attempt: number): number =>
  Math.min(1000 * Math.pow(2, attempt) + Math.random() * 300, 30_000);

const splitChunkParallel = async <T>(
  opts: RunLlmChunkWithRecoveryOptions<T>,
  parts: readonly (readonly T[])[],
): Promise<void> => {
  if (parts.length === 0) return;
  await mapWithConcurrency(parts, Math.min(parts.length, llmChatPipelineConcurrency()), (part) =>
    runLlmChunkWithRecovery({ ...opts, chunk: part }),
  );
};

/** Run one LLM batch with timeout split, bisect-on-error, and exponential backoff. */
export const runLlmChunkWithRecovery = async <T>(
  opts: RunLlmChunkWithRecoveryOptions<T>,
): Promise<void> => {
  const { chunk, runOnce, shouldAbort, onFailure, log, operation } = opts;
  const maxAttempts = opts.maxAttempts ?? CONFIG.llmMaxAttempts;
  const itemIds = opts.itemIds ?? (() => []);

  if (chunk.length === 0) return;
  if (shouldAbort?.()) return;

  log.debug(`${operation} chunk flush`, {
    chunkSize: chunk.length,
    itemIds: itemIds(chunk),
  });

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await runOnce(chunk);
      return;
    } catch (err) {
      if (shouldAbort?.() || isAbortError(err)) return;

      const message = err instanceof Error ? err.message : String(err);

      if (isLlmTimeoutError(err) && chunk.length > 1) {
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
        log.warn(`${operation} chunk retry`, {
          attempt: attempt + 1,
          maxAttempts,
          error: message,
          chunkSize: chunk.length,
          itemIds: itemIds(chunk),
        });
        await new Promise((r) => setTimeout(r, chunkBackoffMs(attempt)));
        continue;
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
  }
};
