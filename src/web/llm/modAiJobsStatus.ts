import { listRunningLlmGenderDetectJobs } from './genderDetectService';
import { listRunningLlmSkipDetectJobs } from './skipDetectService';
import { listRunningLlmTranslateJobs } from './llmTranslateService';
import { listRunningLlmVerifyJobs } from './verifyService';
import { listRunningModVoiceGenerateJobs } from '../voice/modVoiceGenerateService';
import { listRunningTmApplyJobs } from '../services/tmApplyJobService';

export type ModAiJobKind = 'translate' | 'verify' | 'skip-detect' | 'gender-detect' | 'voice';
export type ModTranslateMode = 'tm' | 'llm';

export type ActiveModAiJob = {
  jobId: number;
  modId: number;
  kind: ModAiJobKind;
  done: number;
  total: number;
  status: 'running';
  translateMode?: ModTranslateMode;
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
      translateMode: 'llm',
    });
  }

  for (const job of listRunningTmApplyJobs()) {
    jobs.push({
      jobId: job.jobId,
      modId: job.modId,
      kind: 'translate',
      done: job.done,
      total: job.total,
      status: 'running',
      translateMode: 'tm',
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

  for (const job of listRunningLlmGenderDetectJobs()) {
    jobs.push({
      jobId: job.jobId,
      modId: job.modId,
      kind: 'gender-detect',
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
