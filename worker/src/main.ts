/**
 * Background job worker — sibling package to `web-ui/`.
 *
 * Entry: `npm --prefix worker start` (Docker: same image as web, different command).
 *
 * Flow:
 *   1. BullMQ claims a job from Redis (`transynth-jobs`).
 *   2. `processJob` builds a JobContext and runs the registered handler.
 *   3. Progress goes out as `job.updateProgress` → QueueEvents → API SSE.
 *   4. Snapshots land in Redis for status GETs / reopened modals.
 *   5. Cancel/pause arrive on the control pub/sub channel.
 *
 * Business logic (LLM, imports, voice) still lives under `../src`; this package
 * owns only the queue runtime and the HTTP helpers that routes call.
 */
import { Worker } from 'bullmq';
import { CONFIG } from '../../src/config';
import { closeDb, openDb } from '../../src/db';
import { closeLogStreams } from '../../src/logger';
import { logJobs } from '../../src/logging/loggers';
import { ensureDataDirs } from '../../src/paths';
import { syncTtsPoolFromProjectSettings } from '../../src/voice/voiceProjectSettings';
import { getAllProjectSettings } from '../../src/web/services/projectSettings';
import { closeSharedRedis, createRedisConnection } from './core/connection';
import { subscribeJobControl } from './core/controlChannel';
import { JOBS_QUEUE_NAME } from './core/queue';
import type { JobData } from './types';
import { cancelAllActiveRuns, controlActiveRun, processJob } from './processor';

ensureDataDirs();
const db = openDb();

// TTS pool limits come from project_settings — refresh once at boot.
syncTtsPoolFromProjectSettings(await getAllProjectSettings(db));

const worker = new Worker<JobData>(JOBS_QUEUE_NAME, (job) => processJob(db, job), {
  connection: createRedisConnection('worker'),
  concurrency: CONFIG.jobConcurrency,
  // ESP parsing can block the event loop long enough to miss lock renewal.
  // A 5-minute lock + no stalled re-queue avoids double-running a job after a
  // crash (services already retry their own LLM/HTTP errors).
  lockDuration: 300_000,
  maxStalledCount: 0,
});

worker.on('error', (err) => logJobs.warn(`worker error: ${err.message}`));
worker.on('failed', (job, err) =>
  logJobs.error('job failed', { jobId: job?.id, kind: job?.data.kind, error: err.message }),
);

// Separate Redis connection that listens for Stop / Pause from the API.
const unsubscribeControl = await subscribeJobControl(controlActiveRun);

logJobs.info(`Job worker started (queue=${JOBS_QUEUE_NAME}, concurrency=${CONFIG.jobConcurrency})`);

let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  logJobs.info('Job worker shutting down...');
  // Abort in-flight work so worker.close() does not wait out an hours-long run.
  cancelAllActiveRuns();
  try {
    await worker.close();
  } catch {
    /* connection may already be gone */
  }
  await unsubscribeControl();
  await closeSharedRedis();
  await closeDb();
  closeLogStreams();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (reason) => {
  logJobs.error('Unhandled promise rejection — worker kept running', reason);
});
