/**
 * Singleton BullMQ QueueEvents stream used by the API to relay progress to SSE.
 *
 * Needs its own Redis connection — QueueEvents blocks on XREAD and must not
 * share a client with enqueue / snapshot commands.
 */
import { QueueEvents } from 'bullmq';
import { createRedisConnection } from './connection';
import { JOBS_QUEUE_NAME } from './queue';

let events: QueueEvents | null = null;

export const getJobsQueueEvents = (): QueueEvents => {
  if (!events) {
    events = new QueueEvents(JOBS_QUEUE_NAME, {
      connection: createRedisConnection('queue-events'),
    });
  }
  return events;
};

export const closeJobsQueueEvents = async (): Promise<void> => {
  if (!events) return;
  const instance = events;
  events = null;
  await instance.close();
};
