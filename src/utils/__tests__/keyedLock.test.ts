import { describe, expect, it } from '@jest/globals';
import { withKeyedLock } from '../keyedLock';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

describe('withKeyedLock', () => {
  it('runs the work of one key one at a time, in arrival order', async () => {
    const log: string[] = [];
    const work = (name: string) => async () => {
      log.push(`${name} in`);
      await tick();
      log.push(`${name} out`);
      return name;
    };

    const results = await Promise.all([
      withKeyedLock('unit', work('first')),
      withKeyedLock('unit', work('second')),
      withKeyedLock('unit', work('third')),
    ]);

    expect(results).toEqual(['first', 'second', 'third']);
    expect(log).toEqual([
      'first in',
      'first out',
      'second in',
      'second out',
      'third in',
      'third out',
    ]);
  });

  it('lets other keys through and survives a failure', async () => {
    const log: string[] = [];
    const slow = withKeyedLock('a', async () => {
      await tick();
      log.push('a');
    });
    const other = withKeyedLock('b', async () => {
      log.push('b');
    });
    await Promise.all([slow, other]);
    expect(log).toEqual(['b', 'a']);

    await expect(
      withKeyedLock('a', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await withKeyedLock('a', async () => 'after')).toBe('after');
  });
});
