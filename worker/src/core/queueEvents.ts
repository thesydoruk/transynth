/**
 * BullMQ QueueEvents streams used by the API to relay progress to SSE.
 *
 * Needs its own Redis connection — QueueEvents blocks on XREAD and must not
 * share a client with enqueue / snapshot commands. One bus per queue name.
 */
import { QueueEvents } from 'bullmq';
import { createRedisConnection } from './connection';
import type { JobQueueName } from './queueNames';

const buses = new Map<string, QueueEvents>();

export const getQueueEvents = (name: JobQueueName | string): QueueEvents => {
  let events = buses.get(name);
  if (!events) {
    events = new QueueEvents(name, {
      connection: createRedisConnection(`queue-events:${name}`),
    });
    buses.set(name, events);
  }
  return events;
};

export const closeJobsQueueEvents = async (): Promise<void> => {
  const open = [...buses.values()];
  buses.clear();
  await Promise.all(open.map((events) => events.close()));
};
