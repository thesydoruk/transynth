import type { Logger } from '../../logger';

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

export type WorkPoolState<T> = {
  queue: ChunkWork<T>[];
  inFlight: number;
  pendingDelayed: number;
  shouldAbort?: () => boolean;
  pump: () => void;
  maybeDone: () => void;
};
