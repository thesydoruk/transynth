import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ModVoiceGenerateScope } from '../../../../../api';
import { getModAiJob, subscribeModAiJobs } from '../../../../../modAiJobsStore';
import { startModAiVoice, stopModAiVoice } from '../../../../../modAiVoiceRunner';
import { voiceSpeakerLinesQueryKey, voiceSpeakersQueryKey } from './useVoiceData';

const progressPct = (done: number, total: number): number | null => {
  if (total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
};

/** Shared mod voice job (toolbar indicator) scoped for the active character page. */
export const useSpeakerVoiceGenerate = (
  modId: number,
  speakerKey: string | null,
  srcLang: string,
  targetLang: string,
) => {
  const qc = useQueryClient();
  const [job, setJob] = useState(() => getModAiJob(modId, 'voice'));

  useEffect(() => {
    const refresh = () => setJob(getModAiJob(modId, 'voice'));
    refresh();
    return subscribeModAiJobs(refresh);
  }, [modId]);

  const prevStatus = useRef(job.status);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = job.status;
    if (prev !== 'running' && prev !== 'stopping') return;
    if (job.status !== 'completed' && job.status !== 'cancelled' && job.status !== 'failed') {
      return;
    }
    void qc.invalidateQueries({ queryKey: voiceSpeakersQueryKey(modId, srcLang, targetLang) });
    if (speakerKey) {
      void qc.invalidateQueries({
        queryKey: voiceSpeakerLinesQueryKey(modId, speakerKey, srcLang, targetLang),
      });
    }
  }, [job.status, modId, qc, speakerKey, srcLang, targetLang]);

  const isRunning = job.status === 'running' || job.status === 'stopping';
  const pct = progressPct(job.done, job.total);
  const showBar = isRunning || job.status === 'completed' || job.status === 'failed';

  const start = (scope: ModVoiceGenerateScope) => {
    if (!speakerKey || isRunning) return;
    void startModAiVoice(modId, srcLang, targetLang, scope, speakerKey);
  };

  const stop = () => {
    if (!isRunning) return;
    void stopModAiVoice(modId, job.jobId);
  };

  return {
    job,
    isRunning,
    pct,
    showBar,
    startMissing: () => start('missing'),
    startAll: () => start('all'),
    stop,
  };
};
