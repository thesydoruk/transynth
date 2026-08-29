import { useEffect, useState } from 'react';
import {
  listNexusDownloadJobs,
  subscribeNexusDownloadJobs,
  type NexusDownloadJob,
} from '../../../nexusDownloadQueue';
import { listAppJobs, subscribeAppJobs, type AppJob } from '../../../appJobsQueue';

export const useJobQueueSubscriptions = () => {
  const [nexusDownloads, setNexusDownloads] = useState<NexusDownloadJob[]>(() =>
    listNexusDownloadJobs(),
  );
  const [appJobs, setAppJobs] = useState<AppJob[]>(() => listAppJobs());

  useEffect(() => {
    const unsubscribe = subscribeNexusDownloadJobs(() => {
      setNexusDownloads(listNexusDownloadJobs());
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeAppJobs(() => {
      setAppJobs(listAppJobs());
    });
    return () => {
      unsubscribe();
    };
  }, []);

  return { nexusDownloads, appJobs };
};
