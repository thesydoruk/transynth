import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type Mod, type ModContentKind, type PreviousVersionRow } from '../../../api';
import { useToast } from '../../../components/Toast';
import type { ModsWorkspace } from '../ModsWorkspaceContext';
import type { useModsPageData } from './useModsPageData';
import { useJobQueueSubscriptions } from './useJobQueueSubscriptions';
import { useImportJobRunner } from './useImportJobRunner';
import { useModUpload } from './useModUpload';
import { useModSelection } from './useModSelection';
import { useModExport } from './useModExport';
import { useExportArchives } from './useExportArchives';
import { useModDeleteActions } from './useModDeleteActions';

type Options = {
  gameId: string;
  srcLang: string;
  targetLang: string;
  pageData: ReturnType<typeof useModsPageData>;
  /** Mods the filters leave on the page; selection and batch actions work on these. */
  visibleMods: Mod[];
};

/** Everything the rows and sections of the Mods page share, wired once. */
export const useModsWorkspaceState = ({
  gameId,
  srcLang,
  targetLang,
  pageData,
  visibleMods,
}: Options): ModsWorkspace => {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { showToast } = useToast();
  const [reimport, setReimport] = useState<{
    newModId: number;
    prevVersions: PreviousVersionRow[];
  } | null>(null);

  const { data: vortexGroupsData } = useQuery({
    queryKey: ['vortex-groups', gameId],
    queryFn: () => api.vortex.groups(gameId),
  });
  const vortexGroups = useMemo(
    () => (vortexGroupsData?.groups ?? []).map(({ id, label }) => ({ id, label })),
    [vortexGroupsData],
  );
  const vortexGroupLabel = useCallback(
    (groupId: number | null | undefined) =>
      groupId == null ? undefined : vortexGroups.find((group) => group.id === groupId)?.label,
    [vortexGroups],
  );

  const { nexusDownloads, appJobs } = useJobQueueSubscriptions();
  const importRunner = useImportJobRunner({
    gameId,
    srcLang,
    targetLang,
    onReimportDetected: setReimport,
  });
  const { refreshAll, startAll, handleImportStart } = importRunner;

  const selection = useModSelection(visibleMods);
  const deleteActions = useModDeleteActions({
    refreshAll,
    clearModSelection: selection.clearModSelection,
  });
  const exportArchives = useExportArchives(gameId);
  const { buildExportActions, runBatchLangpackExport, exportingBatchLangpack } = useModExport(
    exportArchives.refresh,
  );
  const upload = useModUpload({
    gameId,
    srcLang,
    tgtLang: targetLang,
    startModImportJob: importRunner.startModImportJob,
    refreshAll,
  });

  const { opsData, activeImportJobs } = pageData;
  const llmJobs = useMemo(
    () => (opsData?.llmJobs ?? []).filter((job) => !job.mod_game || job.mod_game === gameId),
    [opsData, gameId],
  );

  const setContentKind = useCallback(
    async (modId: number, kind: ModContentKind | null) => {
      try {
        await api.mods.setContentKind(modId, kind);
        refreshAll();
      } catch (err) {
        showToast(t('common.error', { message: String(err) }), 'error');
      }
    },
    [refreshAll, showToast, t],
  );

  return {
    gameId,
    srcLang,
    targetLang,
    vortexGroups,
    vortexGroupLabel,
    selection,
    deleteActions,
    buildExportActions,
    exportSelected: () => {
      // One archive keeps one file per game path, and the last mod wins silently:
      // a manual upload and its Vortex copy in one export would overwrite each other.
      const selected = visibleMods.filter((mod) => selection.selectedModIds.has(mod.id));
      const sources = new Set(selected.map((mod) => mod.vortex_group_id ?? null));
      if (sources.size > 1) {
        showToast(t('mods.exportMixedSources'), 'error');
        return;
      }
      void runBatchLangpackExport(
        selected.map((mod) => mod.id),
        srcLang,
        targetLang,
      );
    },
    exportingLangpack: exportingBatchLangpack,
    importJobByModId: pageData.importJobByModId,
    importedModIds: pageData.importedModIds,
    activity: {
      pendingUploads: upload.pendingModUploads,
      nexusDownloads: nexusDownloads.filter((job) => job.gameId === gameId),
      appJobs: appJobs.filter((job) => job.status === 'running' || job.status === 'failed'),
      llmJobs,
      importJobs: activeImportJobs,
      liveProgress: importRunner.liveProgress,
      onImportStart: handleImportStart,
    },
    exportArchives,
    upload: {
      fileRef: upload.fileRef,
      uploading: upload.uploading,
      pendingImportCount: importRunner.pendingCount(activeImportJobs),
      onUpload: () => void upload.handleUpload(),
      onStartAll: () => startAll(activeImportJobs),
      openFilePicker: upload.openFilePicker,
    },
    reimport,
    closeReimport: () => setReimport(null),
    openMod: (modId) => nav(`/games/${gameId}/mods/${modId}`),
    openAiPanel: (modId) => nav(`/games/${gameId}/mods/${modId}?open=ai-verify`),
    setContentKind,
  };
};
