import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ModStressPlaceScope } from '../../../../../api';
import { getModAiJob, subscribeModAiJobs } from '../../../../../modAiJobsStore';
import { startModAiStressPlace, stopModAiStressPlace } from '../../../../../modAiStressPlaceRunner';
import { voiceSpeakerLinesQueryKey, voiceSpeakersQueryKey } from './useVoiceData';

const progressPct = (done: number, total: number): number | null => {
  if (total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
};

/** Shared mod stress-place job scoped for the active character page. */
export const useSpeakerStressPlace = (
  modId: number,
  speakerKey: string | null,
  srcLang: string,
  targetLang: string,
) => {
  const qc = useQueryClient();
  const [job, setJob] = useState(() => getModAiJob(modId, 'stress-place'));

  useEffect(() => {
    const refresh = () => setJob(getModAiJob(modId, 'stress-place'));
    refresh();
    const unsubscribe = subscribeModAiJobs(refresh);
    return () => {
      unsubscribe();
    };
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

  const start = (scope: ModStressPlaceScope) => {
    if (!speakerKey || isRunning) return;
    void startModAiStressPlace(modId, srcLang, targetLang, scope, speakerKey);
  };

  const stop = () => {
    if (!isRunning) return;
    void stopModAiStressPlace(modId, job.jobId);
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
