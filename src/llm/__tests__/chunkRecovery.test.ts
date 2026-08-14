import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { DependencyUnavailableError } from '../../pipeline/errors';
import { runLlmChunkWithRecovery, runLlmChunkWorkPoolFromFeed } from '../chunkRecovery';
import { LlmVerifyMissingIdsError } from '../verifyTranslate';
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

  it('runLlmChunkWorkPoolFromFeed keeps workers busy while feed streams', async () => {
    const order: number[] = [];
    async function* feed() {
      yield [{ id: 1 }, { id: 2 }];
      yield [{ id: 3 }];
    }
    const runOnce = jest.fn(async (chunk: readonly { id: number }[]) => {
      if (chunk.length === 1 && chunk[0]!.id === 2) {
        await new Promise((r) => setTimeout(r, 60));
      }
      order.push(chunk[0]!.id);
      if (chunk.length > 1) throw timeoutErr();
    });

    await runLlmChunkWorkPoolFromFeed(feed(), {
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

  it('solo missing-id errors use maxAttempts then onFailure instead of re-enqueueing solo', async () => {
    const onFailure = jest.fn<(failed: readonly { id: number }[], message: string) => void>();
    const runOnce = jest.fn(async () => {
      throw new LlmVerifyMissingIdsError([42], []);
    });

    await runLlmChunkWithRecovery({
      chunk: [{ id: 42 }],
      runOnce,
      maxAttempts: 3,
      onFailure,
      log: silentLog,
      operation: 'test',
    });

    expect(runOnce).toHaveBeenCalledTimes(3);
    expect(onFailure).toHaveBeenCalledWith([{ id: 42 }], 'LLM verify response missing item id=42');
  });

  it('deferred retry frees the worker for other chunks', async () => {
    const order: string[] = [];
    const runOnce = jest.fn(async (chunk: readonly { id: number }[]) => {
      if (chunk[0]!.id === 1) {
        order.push('fail-1');
        throw new Error('transient');
      }
      order.push(`ok-${chunk[0]!.id}`);
    });

    async function* feed() {
      yield [{ id: 1 }];
      yield [{ id: 2 }];
    }

    await runLlmChunkWorkPoolFromFeed(feed(), {
      concurrency: 1,
      runOnce,
      maxAttempts: 2,
      onFailure: () => {},
      log: silentLog,
      operation: 'test',
    });

    expect(order.indexOf('ok-2')).toBeLessThan(order.lastIndexOf('fail-1'));
    expect(runOnce).toHaveBeenCalledTimes(3);
  });

  it('rethrows DependencyUnavailableError instead of marking rows failed', async () => {
    const onFailure = jest.fn<(failed: readonly { id: number }[], message: string) => void>();
    await expect(
      runLlmChunkWithRecovery({
        chunk: [{ id: 1 }, { id: 2 }],
        runOnce: async () => {
          throw new DependencyUnavailableError('llm', 3, 'down');
        },
        maxAttempts: 3,
        onFailure,
        log: silentLog,
        operation: 'test',
      }),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('stops the work pool when a chunk hits DependencyUnavailableError', async () => {
    async function* feed() {
      yield [{ id: 1 }];
      yield [{ id: 2 }];
    }

    await expect(
      runLlmChunkWorkPoolFromFeed(feed(), {
        concurrency: 1,
        runOnce: async () => {
          throw new DependencyUnavailableError('llm', 2, 'down');
        },
        maxAttempts: 1,
        onFailure: () => {},
        log: silentLog,
        operation: 'test',
      }),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);
  });
});
