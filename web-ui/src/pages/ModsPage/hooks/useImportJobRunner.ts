import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  api,
  type EetProgressEvent,
  type CsvProgressEvent,
  type ModProgressEvent,
  type ModImportJob,
  type PreviousVersionRow,
} from '../../../api';
import { modListQueryKey } from '../../../langDefaults';
import { canStartImportJob, isImportJobResume, type LiveProgress } from '../modsShared';
import type { UnifiedJob } from '../modsPageTypes';

type UseImportJobRunnerOptions = {
  gameId: string;
  srcLang: string;
  targetLang: string;
  onReimportDetected: (payload: { newModId: number; prevVersions: PreviousVersionRow[] }) => void;
  onEetPreview: (jobId: number) => void;
  onCsvPreview: (jobId: number) => void;
};

export const useImportJobRunner = ({
  gameId,
  srcLang,
  targetLang,
  onReimportDetected,
  onEetPreview,
  onCsvPreview,
}: UseImportJobRunnerOptions) => {
  const qc = useQueryClient();
  const [liveProgress, setLiveProgress] = useState<Record<string, LiveProgress>>({});
  const abortRefs = useRef<Record<string, AbortController>>({});

  const refreshAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['eet-imports'] });
    qc.invalidateQueries({ queryKey: ['csv-imports'] });
    qc.invalidateQueries({ queryKey: ['mod-imports'] });
    qc.invalidateQueries({ queryKey: modListQueryKey(gameId, srcLang, targetLang) });
  }, [qc, gameId, srcLang, targetLang]);

  const doStart = useCallback(
    (kind: 'eet' | 'csv' | 'mod', jobId: number): Promise<boolean> => {
      const key = `${kind}:${jobId}`;
      const onProgress = (e: { imported: number; total: number }) => {
        setLiveProgress((prev) => ({ ...prev, [key]: { imported: e.imported, total: e.total } }));
      };
      const cleanup = () => {
        setLiveProgress((prev) => {
          const c = { ...prev };
          delete c[key];
          return c;
        });
        delete abortRefs.current[key];
        refreshAll();
        if (kind === 'mod') {
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
        }
      };

      let promise: Promise<unknown>;
      let abort: AbortController;

      if (kind === 'eet') {
        const r = api.eet.startImport(jobId, onProgress as (e: EetProgressEvent) => void);
        promise = r.promise;
        abort = r.abort;
      } else if (kind === 'csv') {
        const r = api.csv.startImport(jobId, onProgress as (e: CsvProgressEvent) => void);
        promise = r.promise;
        abort = r.abort;
      } else {
        const r = api.modImport.startImport(jobId, onProgress as (e: ModProgressEvent) => void);
        promise = r.promise;
        abort = r.abort;
      }

      abortRefs.current[key] = abort;
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
    (kind: UnifiedJob['kind'], jobId: number, running?: boolean) => {
      const key = `${kind}:${jobId}`;
      return running === true || !!liveProgress[key];
    },
    [liveProgress],
  );

  const startModImportJob = useCallback(
    async (job: ModImportJob) => {
      await api.modImport.updateLanguages(job.id, 'en', job.tgt_lang);
      refreshAll();
      if (job.status === 'completed') {
        await api.modImport.restart(job.id);
      }
      await doStart('mod', job.id);
    },
    [doStart, refreshAll],
  );

  const handleImportStart = useCallback(
    (u: UnifiedJob) => {
      const running = isImportJobRunning(u.kind, u.job.id, u.job.running);
      if (isImportJobResume(u.job, running)) {
        void doStart(u.kind, u.job.id);
        return;
      }
      if (u.kind === 'eet') onEetPreview(u.job.id);
      else if (u.kind === 'csv') onCsvPreview(u.job.id);
      else void startModImportJob(u.job);
    },
    [doStart, isImportJobRunning, onCsvPreview, onEetPreview, startModImportJob],
  );

  const startAll = useCallback(
    (activeImportJobs: UnifiedJob[]) => {
      for (const u of activeImportJobs) {
        if (
          !canStartImportJob(u.job, isImportJobRunning(u.kind, u.job.id, u.job.running), u.kind)
        ) {
          continue;
        }
        if (u.kind === 'mod') void startModImportJob(u.job);
        else void doStart(u.kind, u.job.id);
      }
    },
    [doStart, isImportJobRunning, startModImportJob],
  );

  const pendingCount = useCallback(
    (activeImportJobs: UnifiedJob[]) =>
      activeImportJobs.filter((u) =>
        canStartImportJob(u.job, isImportJobRunning(u.kind, u.job.id, u.job.running), u.kind),
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
