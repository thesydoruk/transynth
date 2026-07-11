import { listRunningLlmSkipDetectJobs } from './llmSkipDetectService';
import { listRunningLlmTranslateJobs } from './llmTranslateService';
import { listRunningLlmVerifyJobs } from './llmVerifyService';
import { listRunningModVoiceGenerateJobs } from '../voice/modVoiceGenerateService';

export type ModAiJobKind = 'translate' | 'verify' | 'skip-detect' | 'voice';

export type ActiveModAiJob = {
  jobId: number;
  modId: number;
  kind: ModAiJobKind;
  done: number;
  total: number;
  status: 'running';
};

/** Snapshot of every mod-scoped AI job currently running in this worker. */
export const listActiveModAiJobs = (): ActiveModAiJob[] => {
  const jobs: ActiveModAiJob[] = [];

  for (const job of listRunningLlmTranslateJobs()) {
    jobs.push({
      jobId: job.jobId,
      modId: job.modId,
      kind: 'translate',
      done: job.done,
      total: job.total,
      status: 'running',
    });
  }

  for (const job of listRunningLlmVerifyJobs()) {
    jobs.push({
      jobId: job.jobId,
      modId: job.modId,
      kind: 'verify',
      done: job.done,
      total: job.total,
      status: 'running',
    });
  }

  for (const job of listRunningLlmSkipDetectJobs()) {
    jobs.push({
      jobId: job.jobId,
      modId: job.modId,
      kind: 'skip-detect',
      done: job.done,
      total: job.total,
      status: 'running',
    });
  }

  for (const job of listRunningModVoiceGenerateJobs()) {
    jobs.push({
      jobId: job.jobId,
      modId: job.modId,
      kind: 'voice',
      done: job.done,
      total: job.total,
      status: 'running',
    });
  }

  return jobs;
};
