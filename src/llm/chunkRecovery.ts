/**
 * Retry / split recovery for batched LLM HTTP calls (translate, verify, skip-detect).
 *
 * On timeout, splits to parallel single-row requests so one slow row does not block
 * siblings in the same HTTP batch. On other transient errors, retries with backoff
 * then bisects in parallel.
 *
 * Retries are re-queued after backoff so workers stay free for other chunks.
 */
import { CONFIG } from '../config';
import { isAbortError, isLlmTimeoutError } from './retry';
import { isLlmTranslateMissingIdsError } from './translate';
import { isLlmVerifyMissingIdsError } from './verifyTranslate';
import { llmChatPipelineConcurrency } from './requestPool';
import { mapWithConcurrency } from '../utils/concurrency';
import type { Logger } from '../logger';

export type ChunkRecoveryLogger = Pick<Logger, 'warn' | 'error' | 'debug'>;

type ChunkWork<T> = { chunk: readonly T[]; attempt: number };

export type LlmChunkRunOnceHelpers<T> = {
  enqueueSplit: (parts: readonly (readonly T[])[]) => void;
};

export type RunLlmChunkWithRecoveryOptions<T> = {
  chunk: readonly T[];
  /** Zero-based recovery attempt for this chunk (used when re-queued after backoff). */
  attempt?: number;
  runOnce: (chunk: readonly T[], helpers: LlmChunkRunOnceHelpers<T>) => Promise<void>;
  shouldAbort?: () => boolean;
  maxAttempts?: number;
  /** When true for an error and chunk.length > 1, bisect and retry each half. */
  shouldSplit?: (err: unknown) => boolean;
  /**
   * When set, split parts are handed to the caller instead of awaited inline.
   * Used by {@link runLlmChunkWorkPool} so a slow split does not hold a pipeline slot.
   */
  enqueueSplit?: (parts: readonly (readonly T[])[]) => void;
  /**
   * When set, failed chunks are scheduled for retry after backoff without blocking the worker.
   */
  enqueueRetry?: (chunk: readonly T[], nextAttempt: number, delayMs: number) => void;
  onFailure: (failed: readonly T[], message: string) => void | Promise<void>;
  log: ChunkRecoveryLogger;
  operation: string;
  itemIds?: (chunk: readonly T[]) => unknown[];
};

export type RunLlmChunkWorkPoolOptions<T> = Omit<
  RunLlmChunkWithRecoveryOptions<T>,
  'chunk' | 'attempt'
> & {
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

const isMissingTranslationChunkError = (err: unknown): boolean =>
  isLlmTranslateMissingIdsError(err) ||
  isLlmVerifyMissingIdsError(err) ||
  (err instanceof Error &&
    /LLM (?:response missing translation|verify response missing item) for id=\d+/.test(
      err.message,
    ));

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

type WorkPoolState<T> = {
  queue: ChunkWork<T>[];
  inFlight: number;
  pendingDelayed: number;
  shouldAbort?: () => boolean;
  pump: () => void;
  maybeDone: () => void;
};

const createWorkPoolState = <T>(
  resolve: () => void,
  shouldAbort?: () => boolean,
): WorkPoolState<T> => {
  const state: WorkPoolState<T> = {
    queue: [],
    inFlight: 0,
    pendingDelayed: 0,
    shouldAbort,
    pump: () => {},
    maybeDone: () => {
      if (state.queue.length === 0 && state.inFlight === 0 && state.pendingDelayed === 0) {
        resolve();
      }
    },
  };
  return state;
};

const makeEnqueueRetry = <T>(
  state: WorkPoolState<T>,
): RunLlmChunkWithRecoveryOptions<T>['enqueueRetry'] => {
  return (chunk, nextAttempt, delayMs) => {
    state.pendingDelayed++;
    setTimeout(() => {
      state.pendingDelayed--;
      if (state.shouldAbort?.()) {
        state.maybeDone();
        return;
      }
      state.queue.push({ chunk: [...chunk], attempt: nextAttempt });
      state.pump();
      state.maybeDone();
    }, delayMs);
  };
};

const runLlmChunkWorkPoolCore = async <T>(
  opts: Omit<RunLlmChunkWorkPoolOptions<T>, 'initialChunks'> & {
    seedQueue: ChunkWork<T>[];
    awaitBufferSpace?: () => Promise<void>;
  },
): Promise<void> => {
  const { seedQueue, concurrency, shouldAbort, awaitBufferSpace, ...recoveryOpts } = opts;

  await new Promise<void>((resolve) => {
    const state = createWorkPoolState<T>(resolve, shouldAbort);
    state.queue = seedQueue.map((work) => ({ ...work, chunk: [...work.chunk] }));

    const enqueueSplit = (parts: readonly (readonly T[])[]): void => {
      for (const part of parts) state.queue.push({ chunk: [...part], attempt: 0 });
      state.pump();
    };

    const enqueueRetry = makeEnqueueRetry(state);

    state.pump = (): void => {
      while (state.queue.length > 0 && state.inFlight < concurrency) {
        if (shouldAbort?.()) break;
        const work = state.queue.shift()!;
        state.inFlight++;
        void runLlmChunkWithRecovery({
          ...recoveryOpts,
          chunk: work.chunk,
          attempt: work.attempt,
          shouldAbort,
          enqueueSplit,
          enqueueRetry,
        }).finally(() => {
          state.inFlight--;
          state.pump();
          state.maybeDone();
        });
      }
      state.maybeDone();
    };

    state.pump();

    if (awaitBufferSpace) {
      void (async () => {
        while (true) {
          await awaitBufferSpace();
          state.pump();
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
    seedQueue: initialChunks.map((chunk) => ({ chunk: [...chunk], attempt: 0 })),
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
  let feedDone = false;
  let feedError: unknown = null;
  let bufferWaiters: Array<() => void> = [];

  const notifyBufferWaiters = (): void => {
    const waiters = bufferWaiters;
    bufferWaiters = [];
    for (const wake of waiters) wake();
  };

  let state!: WorkPoolState<T>;
  let feedPromise!: Promise<void>;

  await new Promise<void>((resolve) => {
    state = createWorkPoolState<T>(() => {
      if (feedDone) resolve();
    }, shouldAbort);

    const enqueueSplit = (parts: readonly (readonly T[])[]): void => {
      for (const part of parts) state.queue.push({ chunk: [...part], attempt: 0 });
      notifyBufferWaiters();
      state.pump();
    };

    const enqueueRetry = makeEnqueueRetry(state);

    state.pump = (): void => {
      while (state.queue.length > 0 && state.inFlight < concurrency) {
        if (shouldAbort?.()) break;
        const work = state.queue.shift()!;
        notifyBufferWaiters();
        state.inFlight++;
        void runLlmChunkWithRecovery({
          ...recoveryOpts,
          chunk: work.chunk,
          attempt: work.attempt,
          shouldAbort,
          enqueueSplit,
          enqueueRetry,
        }).finally(() => {
          state.inFlight--;
          state.pump();
          state.maybeDone();
        });
      }
      state.maybeDone();
    };

    state.pump();

    feedPromise = (async () => {
      try {
        for await (const chunk of feed) {
          if (shouldAbort?.()) break;
          while (state.queue.length >= bufferLimit && !shouldAbort?.()) {
            await new Promise<void>((resolve) => bufferWaiters.push(resolve));
          }
          if (shouldAbort?.()) break;
          state.queue.push({ chunk: [...chunk], attempt: 0 });
          notifyBufferWaiters();
          state.pump();
        }
      } catch (err) {
        feedError = err;
      } finally {
        feedDone = true;
        notifyBufferWaiters();
        state.pump();
      }
    })();
  });

  await feedPromise;
  if (feedError) throw feedError;
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

    if (isLlmTranslateMissingIdsError(err) || isLlmVerifyMissingIdsError(err)) {
      log.warn(`${operation} chunk split to single rows (missing LLM items)`, {
        reason: message,
        chunkSize: chunk.length,
        missingIds: err.missingIds,
        itemIds: itemIds(chunk),
      });
      const missingSet = new Set(err.missingIds);
      const missingParts = chunk.filter((item) => {
        const id =
          (item as { stringId?: number }).stringId ?? (item as { string_id?: number }).string_id;
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
