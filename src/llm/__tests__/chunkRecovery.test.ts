import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { runLlmChunkWithRecovery, runLlmChunkWorkPool } from '../chunkRecovery';
import type { Logger } from '../../logger';

const timeoutErr = (): Error => {
  const err = new Error('Request timed out.');
  err.name = 'APIConnectionTimeoutError';
  return err;
};

const silentLog = {
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as Pick<Logger, 'warn' | 'error' | 'debug'>;

describe('runLlmChunkWithRecovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('splits multi-item chunk to single rows on timeout', async () => {
    const calls: number[][] = [];
    const runOnce = jest.fn(async (chunk: readonly { id: number }[]) => {
      calls.push(chunk.map((item) => item.id));
      if (chunk.length > 1) throw timeoutErr();
    });

    await runLlmChunkWithRecovery({
      chunk: [{ id: 1 }, { id: 2 }],
      runOnce,
      maxAttempts: 1,
      onFailure: () => {},
      log: silentLog,
      operation: 'test',
      itemIds: (c) => c.map((item) => item.id),
    });

    expect(runOnce).toHaveBeenCalledTimes(3);
    expect(calls).toContainEqual([1, 2]);
    expect(calls).toContainEqual([1]);
    expect(calls).toContainEqual([2]);
  });

  it('calls onFailure for a single-item chunk that keeps failing', async () => {
    const onFailure = jest.fn<(failed: readonly { id: number }[], message: string) => void>();
    await runLlmChunkWithRecovery({
      chunk: [{ id: 42 }],
      runOnce: async () => {
        throw timeoutErr();
      },
      maxAttempts: 1,
      onFailure,
      log: silentLog,
      operation: 'test',
    });

    expect(onFailure).toHaveBeenCalledWith([{ id: 42 }], 'Request timed out.');
  });

  it('runLlmChunkWorkPool re-queues split parts without blocking other workers', async () => {
    const order: number[] = [];
    const runOnce = jest.fn(async (chunk: readonly { id: number }[]) => {
      if (chunk.length === 1 && chunk[0]!.id === 2) {
        await new Promise((r) => setTimeout(r, 60));
      }
      order.push(chunk[0]!.id);
      if (chunk.length > 1) throw timeoutErr();
    });

    await runLlmChunkWorkPool({
      initialChunks: [
        [{ id: 1 }, { id: 2 }],
        [{ id: 3 }, { id: 4 }],
      ],
      concurrency: 2,
      runOnce,
      maxAttempts: 1,
      onFailure: () => {},
      log: silentLog,
      operation: 'test',
      itemIds: (c) => c.map((item) => item.id),
    });

    expect(order.indexOf(3)).toBeLessThan(order.indexOf(2));
  });
});
