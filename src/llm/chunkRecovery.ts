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
  /**
   * When set, split parts are handed to the caller instead of awaited inline.
   * Used by {@link runLlmChunkWorkPool} so a slow split does not hold a pipeline slot.
   */
  enqueueSplit?: (parts: readonly (readonly T[])[]) => void;
  onFailure: (failed: readonly T[], message: string) => void | Promise<void>;
  log: ChunkRecoveryLogger;
  operation: string;
  itemIds?: (chunk: readonly T[]) => unknown[];
};

export type RunLlmChunkWorkPoolOptions<T> = Omit<RunLlmChunkWithRecoveryOptions<T>, 'chunk'> & {
  initialChunks: readonly (readonly T[])[];
  concurrency: number;
};

export type RunLlmChunkWorkPoolFromFeedOptions<T> = Omit<
  RunLlmChunkWorkPoolOptions<T>,
  'initialChunks'
> & {
  /** Max chunks buffered ahead of workers (default: concurrency * 2). */
  maxBufferedChunks?: number;
};

const chunkBackoffMs = (attempt: number): number =>
  Math.min(1000 * Math.pow(2, attempt) + Math.random() * 300, 30_000);

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
    runLlmChunkWithRecovery({ ...opts, chunk: part }),
  );
};

const runLlmChunkWorkPoolCore = async <T>(
  opts: Omit<RunLlmChunkWorkPoolOptions<T>, 'initialChunks'> & {
    seedQueue: (readonly T[])[];
    /** When set, the producer pauses while the buffer is full. */
    awaitBufferSpace?: () => Promise<void>;
  },
): Promise<void> => {
  const { seedQueue, concurrency, shouldAbort, awaitBufferSpace, ...recoveryOpts } = opts;
  const queue: (readonly T[])[] = seedQueue.map((chunk) => [...chunk]);
  let inFlight = 0;

  await new Promise<void>((resolve) => {
    const maybeDone = (): void => {
      if (queue.length === 0 && inFlight === 0) resolve();
    };

    const enqueueSplit = (parts: readonly (readonly T[])[]): void => {
      for (const part of parts) queue.push([...part]);
      pump();
    };

    const pump = (): void => {
      while (queue.length > 0 && inFlight < concurrency) {
        if (shouldAbort?.()) break;
        const chunk = queue.shift()!;
        inFlight++;
        void runLlmChunkWithRecovery({
          ...recoveryOpts,
          chunk,
          shouldAbort,
          enqueueSplit,
        }).finally(() => {
          inFlight--;
          pump();
          maybeDone();
        });
      }
      maybeDone();
    };

    pump();

    if (awaitBufferSpace) {
      void (async () => {
        while (true) {
          await awaitBufferSpace();
          pump();
        }
      })();
    }
  });
};

/**
 * Work pool over LLM chunks — workers pull the next chunk as soon as they are free.
 * Split/retry parts are re-queued on the same pool instead of blocking the parent worker.
 */
export const runLlmChunkWorkPool = async <T>(
  opts: RunLlmChunkWorkPoolOptions<T>,
): Promise<void> => {
  const { initialChunks, ...rest } = opts;
  await runLlmChunkWorkPoolCore({
    ...rest,
    seedQueue: initialChunks.map((chunk) => [...chunk]),
  });
};

/**
 * Continuous work pool fed by an async iterable — keeps up to `concurrency` LLM
 * requests in flight while the producer prefetches DB/RAG work ahead of workers.
 */
export const runLlmChunkWorkPoolFromFeed = async <T>(
  feed: AsyncIterable<readonly T[]>,
  opts: RunLlmChunkWorkPoolFromFeedOptions<T>,
): Promise<void> => {
  const { maxBufferedChunks, concurrency, shouldAbort, ...recoveryOpts } = opts;
  const bufferLimit = Math.max(concurrency, maxBufferedChunks ?? concurrency * 2);
  const queue: (readonly T[])[] = [];
  let inFlight = 0;
  let feedDone = false;
  let feedError: unknown = null;
  let bufferWaiters: Array<() => void> = [];
  let pump!: () => void;

  const notifyBufferWaiters = (): void => {
    const waiters = bufferWaiters;
    bufferWaiters = [];
    for (const wake of waiters) wake();
  };

  const feedPromise = (async () => {
    try {
      for await (const chunk of feed) {
        if (shouldAbort?.()) break;
        while (queue.length >= bufferLimit && !shouldAbort?.()) {
          await new Promise<void>((resolve) => bufferWaiters.push(resolve));
        }
        if (shouldAbort?.()) break;
        queue.push([...chunk]);
        notifyBufferWaiters();
        pump();
      }
    } catch (err) {
      feedError = err;
    } finally {
      feedDone = true;
      notifyBufferWaiters();
      pump();
    }
  })();

  await new Promise<void>((resolve) => {
    const maybeDone = (): void => {
      if (feedDone && queue.length === 0 && inFlight === 0) resolve();
    };

    const enqueueSplit = (parts: readonly (readonly T[])[]): void => {
      for (const part of parts) queue.push([...part]);
      notifyBufferWaiters();
      pump();
    };

    pump = (): void => {
      while (queue.length > 0 && inFlight < concurrency) {
        if (shouldAbort?.()) break;
        const chunk = queue.shift()!;
        notifyBufferWaiters();
        inFlight++;
        void runLlmChunkWithRecovery({
          ...recoveryOpts,
          chunk,
          shouldAbort,
          enqueueSplit,
        }).finally(() => {
          inFlight--;
          pump();
          maybeDone();
        });
      }
      maybeDone();
    };

    pump();
  });

  await feedPromise;
  if (feedError) throw feedError;
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
