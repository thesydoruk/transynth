import { api } from '../../api';
import { UnifiedJobRow } from './UnifiedJobRow';
import { useModsWorkspace } from './ModsWorkspaceContext';

/** Imports that are running, waiting or whose mod is not in the list yet. */
export const ActiveImportJobsList = () => {
  const { srcLang, targetLang, importedModIds, activity, deleteActions, buildExportActions } =
    useModsWorkspace();
  const { importJobs, liveProgress, onImportStart } = activity;

  return (
    <>
      {importJobs.map((job) => {
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
                    onClearRows: () =>
                      deleteActions.setPendingClear({ id: job.mod_id!, name: job.file_name }),
                    onDeleteAll: () =>
                      deleteActions.requestDeleteMods([{ id: job.mod_id!, name: job.file_name }]),
                    clearingRows: deleteActions.clearingModId === job.mod_id,
                    deletingAll: deleteActions.deletingAll,
                  }
                : undefined
            }
            onStart={() => onImportStart(job)}
            onPause={() => api.modImport.pause(job.id)}
            onCancel={() => api.modImport.cancel(job.id)}
            onDelete={() => deleteActions.setDeleteModalJob(job)}
          />
        );
      })}
    </>
  );
};
