/**
 * Bounded-concurrency helpers for LLM / embed workloads.
 */

/** Simple counting semaphore — limits concurrent in-flight async operations. */
export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private max: number) {}

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  get maxConcurrency(): number {
    return this.max;
  }

  /** Update the concurrency cap; queued waiters are resumed when the limit increases. */
  setMaxConcurrency(max: number): void {
    this.max = Math.max(1, max);
    while (this.active < this.max && this.queue.length > 0) {
      this.active++;
      const next = this.queue.shift()!;
      next();
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) {
      this.active++;
      next();
    }
  }
}

export type MapWithConcurrencyOptions = {
  /** When true, workers stop claiming new items; already in-flight work still finishes. */
  shouldAbort?: () => boolean;
};

/**
 * Run an async mapper over items with at most `concurrency` tasks in flight.
 * Result order matches input order. Aborted indices stay unset (`undefined`).
 */
export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  opts?: MapWithConcurrencyOptions,
): Promise<R[]> => {
  if (items.length === 0) return [];

  const limit = Math.max(1, concurrency);
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      if (opts?.shouldAbort?.()) return;
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
};

/**
 * Worker pool over an async iterable — workers pull the next item as soon as they
 * are free. Unlike {@link mapWithConcurrency}, there is no batch barrier: one slow
 * item never blocks unrelated items still in the stream.
 */
export const runPoolOverAsyncIterable = async <T>(
  items: AsyncIterable<T>,
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> => {
  const limit = Math.max(1, concurrency);
  const iterator = items[Symbol.asyncIterator]();

  const worker = async (): Promise<void> => {
    while (true) {
      const next = await iterator.next();
      if (next.done) return;
      await fn(next.value);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));
};
