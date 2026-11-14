import { api, type ModImportJob } from '../../api';
import { UnifiedJobRow } from './UnifiedJobRow';
import type { LiveProgress, ModExportAction } from './modsShared';

type ActiveImportJobsListProps = {
  jobs: ModImportJob[];
  liveProgress: Record<number, LiveProgress>;
  importedModIds: Set<number>;
  srcLang: string;
  targetLang: string;
  clearingModId: number | null;
  deletingAll: boolean;
  buildExportActions: (
    modId: number,
    labelName: string,
    exportSrcLang: string,
    exportTgtLang: string,
    busyPrefix: string,
  ) => ModExportAction[];
  onStart: (job: ModImportJob) => void;
  onDeleteModJob: (job: ModImportJob) => void;
  onClearRows: (modId: number, name: string) => void;
  onDeleteAll: (mods: Array<{ id: number; name: string }>) => void;
};

export const ActiveImportJobsList = ({
  jobs,
  liveProgress,
  importedModIds,
  srcLang,
  targetLang,
  clearingModId,
  deletingAll,
  buildExportActions,
  onStart,
  onDeleteModJob,
  onClearRows,
  onDeleteAll,
}: ActiveImportJobsListProps) =>
  jobs.map((job) => {
    const live = liveProgress[job.id];
    const isRunning = job.running || !!live;
    const orphanedCompletedMod =
      !!job.mod_id && job.status === 'completed' && !importedModIds.has(job.mod_id);
    const exportActions = orphanedCompletedMod
      ? buildExportActions(job.mod_id!, job.file_name, srcLang, targetLang, String(job.id))
      : [];

    return (
      <UnifiedJobRow
        key={job.id}
        job={job}
        live={live}
        isRunning={isRunning}
        exportActions={exportActions}
        modDataMenu={
          job.mod_id != null
            ? {
                onClearRows: () => onClearRows(job.mod_id!, job.file_name),
                onDeleteAll: () => onDeleteAll([{ id: job.mod_id!, name: job.file_name }]),
                clearingRows: clearingModId === job.mod_id,
                deletingAll,
              }
            : undefined
        }
        onStart={() => onStart(job)}
        onPause={() => api.modImport.pause(job.id)}
        onCancel={() => api.modImport.cancel(job.id)}
        onDelete={() => onDeleteModJob(job)}
      />
    );
  });
