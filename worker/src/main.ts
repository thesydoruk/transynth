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
 * Job bodies and handlers live under `./jobs` (feature folders), including the
 * mod/CSV/EET ingestion loops. Their parsing and job-row helpers stay in
 * `../src/import`, which the upload/list routes also use.
 */
import { Worker } from 'bullmq';
import { CONFIG } from '../../src/config';
import { closeDb, openDb } from '../../src/db';
import { closeLogStreams } from '../../src/logger';
import { logJobs } from '../../src/logging/loggers';
import { ensureDataDirs } from '../../src/paths';
import { syncLlmPoolFromProjectSettings } from '../../src/llm/llmProjectSettings';
import { syncTtsPoolFromProjectSettings } from '../../src/voice/voiceProjectSettings';
import { getAllProjectSettings } from '../../src/web/services/projectSettings';
import { shutdownWine } from '../../src/wine/windowsToolExec';
import { closeSharedRedis, createRedisConnection } from './core/connection';
import { subscribeJobControl } from './core/controlChannel';
import { JOBS_QUEUE_NAME } from './core/queue';
import {
  recoverOrphanedVoiceGenerateJobs,
  requeueStalledVoiceGenerate,
} from './core/recoverVoiceJobs';
import type { JobData } from './types';
import { cancelAllActiveRuns, controlActiveRun, processJob } from './processor';

ensureDataDirs();
const db = openDb();

// TTS / LLM pool limits come from project_settings — refresh once at boot.
{
  const projectSettings = await getAllProjectSettings(db);
  syncTtsPoolFromProjectSettings(projectSettings);
  syncLlmPoolFromProjectSettings(projectSettings);
}

await recoverOrphanedVoiceGenerateJobs();

const worker = new Worker<JobData>(JOBS_QUEUE_NAME, (job) => processJob(db, job), {
  connection: createRedisConnection('worker'),
  concurrency: CONFIG.jobConcurrency,
  // ESP parsing can block the event loop long enough to miss lock renewal.
  // A 5-minute lock + no stalled re-queue avoids double-running LLM/import
  // jobs. voice-generate is re-queued separately (scope=missing is safe).
  lockDuration: 300_000,
  maxStalledCount: 0,
});

worker.on('error', (err) => logJobs.warn(`worker error: ${err.message}`));
worker.on('failed', (job, err) => {
  logJobs.error('job failed', { jobId: job?.id, kind: job?.data.kind, error: err.message });
  if (job) void requeueStalledVoiceGenerate(job, err);
});

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
  shutdownWine();
  closeLogStreams();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (reason) => {
  logJobs.error('Unhandled promise rejection — worker kept running', reason);
});
