import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  api,
  type ModProgressEvent,
  type ModImportJob,
  type PreviousVersionRow,
} from '../../../api';
import { modListQueryKey } from '../../../langDefaults';
import { canStartImportJob, isImportJobResume, type LiveProgress } from '../modsShared';

type UseImportJobRunnerOptions = {
  gameId: string;
  srcLang: string;
  targetLang: string;
  onReimportDetected: (payload: { newModId: number; prevVersions: PreviousVersionRow[] }) => void;
};

export const useImportJobRunner = ({
  gameId,
  srcLang,
  targetLang,
  onReimportDetected,
}: UseImportJobRunnerOptions) => {
  const qc = useQueryClient();
  const [liveProgress, setLiveProgress] = useState<Record<number, LiveProgress>>({});
  const abortRefs = useRef<Record<number, AbortController>>({});

  const refreshAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['mod-imports'] });
    qc.invalidateQueries({ queryKey: modListQueryKey(gameId, srcLang, targetLang) });
  }, [qc, gameId, srcLang, targetLang]);

  const doStart = useCallback(
    (jobId: number): Promise<boolean> => {
      const onProgress = (e: { imported: number; total: number }) => {
        setLiveProgress((prev) => ({
          ...prev,
          [jobId]: { imported: e.imported, total: e.total },
        }));
      };
      const cleanup = () => {
        setLiveProgress((prev) => {
          const c = { ...prev };
          delete c[jobId];
          return c;
        });
        delete abortRefs.current[jobId];
        refreshAll();
        api.modImport
          .list()
          .then((jobs) => {
            const job = jobs.find((j) => j.id === jobId);
            if (job?.mod_id != null) {
              api.mods
                .previousVersions(job.mod_id)
                .then((prev) => {
                  if (prev.length > 0) {
                    onReimportDetected({ newModId: job.mod_id!, prevVersions: prev });
                  }
                })
                .catch(() => {});
            }
          })
          .catch(() => {});
      };

      const { promise, abort } = api.modImport.startImport(
        jobId,
        onProgress as (e: ModProgressEvent) => void,
      );
      abortRefs.current[jobId] = abort;
      const done = promise
        .then(() => {
          cleanup();
          return true;
        })
        .catch(() => {
          cleanup();
          return false;
        });
      refreshAll();
      return done;
    },
    [onReimportDetected, refreshAll],
  );

  const isImportJobRunning = useCallback(
    (jobId: number, running?: boolean) => running === true || !!liveProgress[jobId],
    [liveProgress],
  );

  const startModImportJob = useCallback(
    async (job: ModImportJob) => {
      await api.modImport.updateLanguages(job.id, 'en', job.tgt_lang);
      refreshAll();
      if (job.status === 'completed') {
        await api.modImport.restart(job.id);
      }
      await doStart(job.id);
    },
    [doStart, refreshAll],
  );

  const handleImportStart = useCallback(
    (job: ModImportJob) => {
      const running = isImportJobRunning(job.id, job.running);
      if (isImportJobResume(job, running)) {
        void doStart(job.id);
        return;
      }
      void startModImportJob(job);
    },
    [doStart, isImportJobRunning, startModImportJob],
  );

  const startAll = useCallback(
    (activeImportJobs: ModImportJob[]) => {
      for (const job of activeImportJobs) {
        if (!canStartImportJob(job, isImportJobRunning(job.id, job.running))) continue;
        void startModImportJob(job);
      }
    },
    [isImportJobRunning, startModImportJob],
  );

  const pendingCount = useCallback(
    (activeImportJobs: ModImportJob[]) =>
      activeImportJobs.filter((job) =>
        canStartImportJob(job, isImportJobRunning(job.id, job.running)),
      ).length,
    [isImportJobRunning],
  );

  return {
    liveProgress,
    refreshAll,
    doStart,
    isImportJobRunning,
    startModImportJob,
    handleImportStart,
    startAll,
    pendingCount,
  };
};
