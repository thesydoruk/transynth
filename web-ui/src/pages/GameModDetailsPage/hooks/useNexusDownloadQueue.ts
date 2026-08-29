import { useEffect, useState } from 'react';
import {
  listNexusDownloadJobs,
  type NexusDownloadJob,
  subscribeNexusDownloadJobs,
} from '../../../nexusDownloadQueue';

export const useNexusDownloadQueue = (): NexusDownloadJob[] => {
  const [nexusDownloads, setNexusDownloads] = useState<NexusDownloadJob[]>(listNexusDownloadJobs);

  useEffect(() => {
    const unsubscribe = subscribeNexusDownloadJobs(() =>
      setNexusDownloads(listNexusDownloadJobs()),
    );
    return () => {
      unsubscribe();
    };
  }, []);

  return nexusDownloads;
};
