/**
 * Background job worker — sibling package to `web-ui/`.
 *
 * Entry: `npm --prefix worker start` (Docker: same image as web, different command).
 *
 * Flow:
 *   1. BullMQ claims a job from Redis (one queue per resource: `transynth-jobs` for
 *      CPU work, `-llm`, `-voice`, `-asr`, `-separate`; `WORKER_QUEUES` picks which
 *      queues this process serves).
 *   2. `processJob` builds a JobContext and runs the registered handler.
 *   3. Progress goes out as `job.updateProgress` → QueueEvents → API SSE.
 *   4. Snapshots land in Redis for status GETs / reopened modals.
 *   5. Cancel/pause arrive on the control pub/sub channel.
 *
 * Job bodies and handlers live under `./jobs` (feature folders), including the
 * mod/CSV/EET ingestion loops. Their parsing and job-row helpers stay in
 * `../src/import`, which the upload/list routes also use.
 */
// Registers the game plugins; every registry lookup below depends on it.
import '../../src/games';
import { Worker } from 'bullmq';
import { CONFIG } from '../../src/config';
import { closeDb, openDb } from '../../src/db';
import { closeLogStreams } from '../../src/logger';
import { logJobs } from '../../src/logging/loggers';
import { ensureDataDirs } from '../../src/paths';
import { syncLlmPoolFromProjectSettings } from '../../src/llm/llmProjectSettings';
import { syncTtsPoolFromProjectSettings } from '../../src/voice/voiceProjectSettings';
import { startServiceSettingsWatcher } from '../../src/services/settingsWatcher';
import { getAllProjectSettings } from '../../src/web/services/projectSettings';
import { closeSharedRedis, createRedisConnection } from './core/connection';
import { subscribeJobControl } from './core/controlChannel';
import { installVoiceLivePublisher } from './core/voiceLiveChannel';
import { listActiveJobs } from './core/queue';
import { queueConcurrency, servedQueueIds, QUEUE_NAME_BY_ID } from './core/jobKinds';
import { migrateJobsToDedicatedQueues } from './core/migrateJobQueues';
import { recoverOrphanedLlmJobs, requeueStalledLlmJob } from './core/recoverLlmJobs';
import {
  recoverOrphanedVoiceGenerateJobs,
  requeueStalledVoiceGenerate,
} from './core/recoverVoiceJobs';
import type { JobData } from './types';
import { cancelAllActiveRuns, controlActiveRun, processJob } from './processor';

ensureDataDirs();
const db = openDb();

// TTS / LLM pool limits come from project_settings — refresh at boot, then watch for
// rows other processes write (the fleet controller's managed endpoints).
{
  const projectSettings = await getAllProjectSettings(db);
  syncTtsPoolFromProjectSettings(projectSettings);
  syncLlmPoolFromProjectSettings(projectSettings);
}
const stopSettingsWatcher = startServiceSettingsWatcher({
  read: () => getAllProjectSettings(db),
  apply: (settings) => {
    syncTtsPoolFromProjectSettings(settings);
    syncLlmPoolFromProjectSettings(settings);
  },
  log: logJobs,
});

installVoiceLivePublisher();

// Only the queues this process serves: a worker that serves `cpu` alone must not fail
// and re-enqueue an `llm` job that a live `llm` worker is still running.
const servedIds = servedQueueIds();
const servedNames = servedIds.map((id) => QUEUE_NAME_BY_ID[id]);
const activeOnServedQueues = () => listActiveJobs(servedNames);

await migrateJobsToDedicatedQueues();
if (servedIds.includes('tts')) {
  await recoverOrphanedVoiceGenerateJobs({ getActiveJobs: activeOnServedQueues });
}
if (servedIds.includes('llm')) {
  await recoverOrphanedLlmJobs({ getActiveJobs: activeOnServedQueues });
}

const startQueueWorker = (
  queueName: string,
  role: string,
  concurrency: number,
): Worker<JobData> => {
  const worker = new Worker<JobData>(queueName, (job) => processJob(db, job), {
    connection: createRedisConnection(role),
    concurrency,
    // ESP parsing can block the event loop long enough to miss lock renewal.
    // A 5-minute lock + no stalled re-queue avoids double-running LLM/import.
    // voice-generate is re-queued as missing without resetVoice.
    lockDuration: 300_000,
    maxStalledCount: 0,
  });
  worker.on('error', (err) => logJobs.warn(`worker error (${queueName}): ${err.message}`));
  worker.on('failed', (job, err) => {
    logJobs.error('job failed', {
      queue: queueName,
      jobId: job?.id,
      kind: job?.data.kind,
      error: err.message,
    });
    if (job) {
      void requeueStalledVoiceGenerate(job, err);
      void requeueStalledLlmJob(job, err);
    }
  });
  return worker;
};

const workers = servedIds.map((id) =>
  startQueueWorker(
    QUEUE_NAME_BY_ID[id],
    `${id}-worker`,
    queueConcurrency(id, process.env, CONFIG.jobConcurrency),
  ),
);

// Separate Redis connection that listens for Stop / Pause from the API.
const unsubscribeControl = await subscribeJobControl(controlActiveRun);

logJobs.info(
  `Job workers started: ${servedIds
    .map((id) => `${id}=${queueConcurrency(id, process.env, CONFIG.jobConcurrency)}`)
    .join(', ')}`,
);

let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  logJobs.info('Job worker shutting down...');
  stopSettingsWatcher();
  // Abort in-flight work so worker.close() does not wait out an hours-long run.
  cancelAllActiveRuns();
  await Promise.all(
    workers.map(async (worker) => {
      try {
        await worker.close();
      } catch {
        /* connection may already be gone */
      }
    }),
  );
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
