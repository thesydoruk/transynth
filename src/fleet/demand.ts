/**
 * Demand per service kind, read from the job queues.
 *
 * Every job kind declares the services it needs (`worker/src/core/jobKinds.ts`), so a
 * queue's waiting and active jobs translate into kinds that must be up. A kind is in
 * demand while any queue that needs it has jobs waiting or running.
 */
import type { ServiceKind } from '../services/kinds';
import {
  JOB_KIND_SPECS,
  JOB_QUEUE_IDS,
  QUEUE_NAME_BY_ID,
  kindsOnQueue,
  type JobQueueId,
} from '../../worker/src/core/jobKinds';
import type { Demand } from './scheduler';

export type QueueCounts = { waiting: number; active: number };

/** Service kinds any job on a queue may need. */
export const kindsNeededByQueue = (queue: JobQueueId): ServiceKind[] => {
  const out = new Set<ServiceKind>();
  for (const kind of kindsOnQueue(queue)) {
    for (const need of JOB_KIND_SPECS[kind].needs) out.add(need);
  }
  return [...out];
};

/**
 * Fold queue counts into demand per kind, plus the kinds jobs signal themselves while they
 * wait for a service their queue does not declare (`want.ts`); such a want counts as one
 * active job. Both readers are injected for tests.
 */
export const readDemand = async (
  readCounts: (queueName: string) => Promise<QueueCounts>,
  readWants: () => Promise<ServiceKind[]> = async () => [],
): Promise<Demand> => {
  const demand: Demand = {};
  for (const queue of JOB_QUEUE_IDS) {
    const kinds = kindsNeededByQueue(queue);
    if (kinds.length === 0) continue;
    const counts = await readCounts(QUEUE_NAME_BY_ID[queue]);
    for (const kind of kinds) {
      const row = demand[kind] ?? { waiting: 0, active: 0 };
      row.waiting += counts.waiting;
      row.active += counts.active;
      demand[kind] = row;
    }
  }
  for (const kind of await readWants()) {
    const row = demand[kind] ?? { waiting: 0, active: 0 };
    row.active += 1;
    demand[kind] = row;
  }
  return demand;
};

/** BullMQ-backed counts: waiting + delayed + prioritized + paused count as waiting. */
export const bullQueueCounts = async (queueName: string): Promise<QueueCounts> => {
  const { getQueueByName } = await import('../../worker/src/core/queue');
  const counts = await getQueueByName(queueName).getJobCounts(
    'waiting',
    'delayed',
    'prioritized',
    'paused',
    'active',
  );
  return {
    waiting:
      (counts.waiting ?? 0) +
      (counts.delayed ?? 0) +
      (counts.prioritized ?? 0) +
      (counts.paused ?? 0),
    active: counts.active ?? 0,
  };
};
