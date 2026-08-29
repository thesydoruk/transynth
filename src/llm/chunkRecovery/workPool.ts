import { isDependencyUnavailableError } from '../../pipeline/errors';
import { createWorkPoolState, makeEnqueueRetry } from './workPoolState';
import { runLlmChunkWithRecovery } from './recovery';
import type {
  RunLlmChunkWorkPoolFromFeedOptions,
  RunLlmChunkWorkPoolOptions,
  WorkPoolState,
} from './types';

const runLlmChunkWorkPoolCore = async <T>(
  opts: Omit<RunLlmChunkWorkPoolOptions<T>, 'initialChunks'> & {
    seedQueue: Array<{ chunk: readonly T[]; attempt: number }>;
    awaitBufferSpace?: () => Promise<void>;
  },
): Promise<void> => {
  const { seedQueue, concurrency, shouldAbort, awaitBufferSpace, ...recoveryOpts } = opts;

  let fatalError: unknown = null;
  const shouldStop = (): boolean => Boolean(fatalError) || Boolean(shouldAbort?.());

  await new Promise<void>((resolve) => {
    const state = createWorkPoolState<T>(resolve, shouldStop);
    state.queue = seedQueue.map((work) => ({ ...work, chunk: [...work.chunk] }));

    const enqueueSplit = (parts: readonly (readonly T[])[]): void => {
      for (const part of parts) state.queue.push({ chunk: [...part], attempt: 0 });
      state.pump();
    };

    const enqueueRetry = makeEnqueueRetry(state);

    state.pump = (): void => {
      while (state.queue.length > 0 && state.inFlight < concurrency) {
        if (shouldStop()) break;
        const work = state.queue.shift()!;
        state.inFlight++;
        void runLlmChunkWithRecovery({
          ...recoveryOpts,
          chunk: work.chunk,
          attempt: work.attempt,
          shouldAbort: shouldStop,
          enqueueSplit,
          enqueueRetry,
        })
          .catch((err) => {
            if (isDependencyUnavailableError(err)) {
              fatalError = err;
              state.queue.length = 0;
            }
          })
          .finally(() => {
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

  if (fatalError) throw fatalError;
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
  let fatalError: unknown = null;
  const shouldStop = (): boolean => Boolean(fatalError) || Boolean(shouldAbort?.());

  await new Promise<void>((resolve) => {
    state = createWorkPoolState<T>(() => {
      if (feedDone) resolve();
    }, shouldStop);

    const enqueueSplit = (parts: readonly (readonly T[])[]): void => {
      for (const part of parts) state.queue.push({ chunk: [...part], attempt: 0 });
      notifyBufferWaiters();
      state.pump();
    };

    const enqueueRetry = makeEnqueueRetry(state);

    state.pump = (): void => {
      while (state.queue.length > 0 && state.inFlight < concurrency) {
        if (shouldStop()) break;
        const work = state.queue.shift()!;
        notifyBufferWaiters();
        state.inFlight++;
        void runLlmChunkWithRecovery({
          ...recoveryOpts,
          chunk: work.chunk,
          attempt: work.attempt,
          shouldAbort: shouldStop,
          enqueueSplit,
          enqueueRetry,
        })
          .catch((err) => {
            if (isDependencyUnavailableError(err)) {
              fatalError = err;
              state.queue.length = 0;
              notifyBufferWaiters();
            }
          })
          .finally(() => {
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
          if (shouldStop()) break;
          while (state.queue.length >= bufferLimit && !shouldStop()) {
            await new Promise<void>((resolve) => bufferWaiters.push(resolve));
          }
          if (shouldStop()) break;
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
  if (fatalError) throw fatalError;
  if (feedError) throw feedError;
};
