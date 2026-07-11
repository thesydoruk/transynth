import { findRunningLlmTranslateJob } from '../llm/llmTranslateService';
import { findRunningTmApplyJob } from './tmApplyJobService';

export type ModTranslateMode = 'tm' | 'llm';

/** Returns a running mod-wide translate job (TM or LLM), if any. */
export const findRunningModTranslateJob = (
  modId: number,
): { jobId: number; mode: ModTranslateMode } | null => {
  const tmJobId = findRunningTmApplyJob(modId);
  if (tmJobId != null) return { jobId: tmJobId, mode: 'tm' };

  const llmJobId = findRunningLlmTranslateJob(modId);
  if (llmJobId != null) return { jobId: llmJobId, mode: 'llm' };

  return null;
};
