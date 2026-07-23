import { api, type ModImportJob } from '../../api';
import { UnifiedJobRow } from './UnifiedJobRow';
import type { LiveProgress } from './modsShared';
import type { UnifiedJob } from './modsPageTypes';

type ExportAction = {
  key: 'langpack' | 'fullMod';
  icon: string;
  title: string;
  disabled?: boolean;
  onClick: () => void;
};

type ActiveImportJobsListProps = {
  jobs: UnifiedJob[];
  liveProgress: Record<string, LiveProgress>;
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
  ) => ExportAction[];
  onStart: (job: UnifiedJob) => void;
  onDeleteModJob: (job: ModImportJob) => void;
  onDeleteSimpleJob: (kind: 'eet' | 'csv', name: string, id: number) => void;
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
  onDeleteSimpleJob,
  onClearRows,
  onDeleteAll,
}: ActiveImportJobsListProps) =>
  jobs.map((u) => {
    const key = `${u.kind}:${u.job.id}`;
    const live = liveProgress[key];
    const isRunning = u.job.running || !!live;
    const modJob = u.kind === 'mod' ? u.job : null;
    const orphanedCompletedMod =
      !!modJob?.mod_id && modJob.status === 'completed' && !importedModIds.has(modJob.mod_id);
    const exportActions =
      orphanedCompletedMod && modJob?.mod_id
        ? buildExportActions(
            modJob.mod_id,
            modJob.file_name,
            srcLang,
            targetLang,
            String(modJob.id),
          )
        : [];

    return (
      <UnifiedJobRow
        key={key}
        kind={u.kind}
        job={u.job}
        live={live}
        isRunning={isRunning}
        exportActions={exportActions}
        modDataMenu={
          modJob?.mod_id != null
            ? {
                onClearRows: () => onClearRows(modJob.mod_id!, modJob.file_name),
                onDeleteAll: () => onDeleteAll([{ id: modJob.mod_id!, name: modJob.file_name }]),
                clearingRows: clearingModId === modJob.mod_id,
                deletingAll,
              }
            : undefined
        }
        onStart={() => onStart(u)}
        onPause={() => {
          if (u.kind === 'eet') api.eet.pause(u.job.id);
          else if (u.kind === 'csv') api.csv.pause(u.job.id);
          else api.modImport.pause(u.job.id);
        }}
        onCancel={() => {
          if (u.kind === 'eet') api.eet.cancel(u.job.id);
          else if (u.kind === 'csv') api.csv.cancel(u.job.id);
          else api.modImport.cancel(u.job.id);
        }}
        onDelete={() => {
          if (u.kind === 'mod') {
            onDeleteModJob(u.job as ModImportJob);
            return;
          }
          onDeleteSimpleJob(u.kind, u.job.file_name, u.job.id);
        }}
      />
    );
  });
