import { useEffect, useState } from 'react';
import { getModAiJobsForMod, subscribeModAiJobs } from '../modAiJobsStore';

/** Reactive snapshot of all three AI job slots for one mod. */
export const useModAiJobsForMod = (modId: number) => {
  const [jobs, setJobs] = useState(() => getModAiJobsForMod(modId));

  useEffect(() => {
    const refresh = () => setJobs(getModAiJobsForMod(modId));
    refresh();
    const unsubscribe = subscribeModAiJobs(refresh);
    return () => {
      unsubscribe();
    };
  }, [modId]);

  return jobs;
};
