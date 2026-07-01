import { describe, it, expect } from '@jest/globals';
import { RequestPool } from '../requestPool';
import { Semaphore } from '../../utils/concurrency';

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('RequestPool', () => {
  it('limits concurrent chat requests independently', async () => {
    const pool = new RequestPool(new Semaphore(2));
    let inFlight = 0;
    let maxInFlight = 0;

    const task = () =>
      pool.run(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await tick();
        inFlight--;
      });

    await Promise.all([task(), task(), task(), task()]);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('keeps embed and chat pools independent', async () => {
    const chatPool = new RequestPool(new Semaphore(1));
    const embedPool = new RequestPool(new Semaphore(1));
    const events: string[] = [];

    const embedHold = embedPool.run(async () => {
      events.push('embed-start');
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      });
      events.push('embed-end');
    });

    await tick();

    const chatParallel = chatPool.run(async () => {
      events.push('chat-start');
      events.push('chat-end');
    });

    await tick();
    await Promise.all([embedHold, chatParallel]);

    expect(events.indexOf('chat-start')).toBeLessThan(events.indexOf('embed-end'));
  });
});
