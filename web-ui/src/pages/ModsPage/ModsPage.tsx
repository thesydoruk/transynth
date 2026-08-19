/**
 * ModsPage — unified mod workspace for a game.
 *
 * Combines imported mod translation progress with import job management:
 * upload bar, active EET/CSV/mod imports, and imported mod rows with editor access.
 *
 * URL: /games/:gameId/mods
 */
import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { useTranslation } from 'react-i18next';
import type { PreviousVersionRow } from '../../api';
import { useContentLangs } from '../../hooks/useContentLangs';
import { useModAiJobsPoll } from '../../hooks/useModAiJobsPoll';
import { ModsPageUploadBar } from './ModsPageUploadBar';
import { ModsPageEmptyState } from './ModsPageEmptyState';
import { ModsPageJobList } from './ModsPageJobList';
import { ModsPageModals } from './ModsPageModals';
import {
  useModsPageData,
  useJobQueueSubscriptions,
  useImportJobRunner,
  useModUpload,
  useModSelection,
  useModExport,
  useModDeleteActions,
} from './hooks';
import s from './ModsPage.module.scss';

export const ModsPage = () => {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { gameId = 'fo4' } = useParams<{ gameId: string }>();
  const { srcLang, targetLang } = useContentLangs();
  useModAiJobsPoll(true);

  const [eetPreviewId, setEetPreviewId] = useState<number | null>(null);
  const [csvPreviewId, setCsvPreviewId] = useState<number | null>(null);
  const [reimport, setReimport] = useState<{
    newModId: number;
    prevVersions: PreviousVersionRow[];
  } | null>(null);

  const pageData = useModsPageData(gameId, srcLang, targetLang);
  const {
    isModsLoading,
    modsError,
    eetJobs,
    csvJobs,
    opsData,
    importJobByModId,
    importedModIds,
    activeImportJobs,
    sortedMods,
  } = pageData;

  const { nexusDownloads, appJobs } = useJobQueueSubscriptions();

  const importRunner = useImportJobRunner({
    gameId,
    srcLang,
    targetLang,
    onReimportDetected: setReimport,
    onEetPreview: setEetPreviewId,
    onCsvPreview: setCsvPreviewId,
  });
  const {
    liveProgress,
    refreshAll,
    doStart,
    handleImportStart,
    startAll,
    pendingCount: countPendingImports,
  } = importRunner;

  const selection = useModSelection(sortedMods);

  const deleteActions = useModDeleteActions({
    refreshAll,
    clearModSelection: selection.clearModSelection,
  });

  const { buildExportActions, runBatchLangpackExport, exportingBatchLangpack } = useModExport();

  const upload = useModUpload({
    gameId,
    doStart,
    startModImportJob: importRunner.startModImportJob,
    refreshAll,
  });

  const openModAiPanel = useCallback(
    (modId: number) => {
      nav(`/games/${gameId}/mods/${modId}?open=ai-verify`);
    },
    [gameId, nav],
  );

  const eetPreviewJob =
    eetPreviewId != null ? (eetJobs ?? []).find((j) => j.id === eetPreviewId) : null;
  const csvPreviewJob =
    csvPreviewId != null ? (csvJobs ?? []).find((j) => j.id === csvPreviewId) : null;
  const visibleNexusDownloads = nexusDownloads.filter((d) => d.gameId === gameId);
  const visibleAppJobs = appJobs.filter((j) => j.status === 'running' || j.status === 'failed');
  const backendLlmJobs = opsData?.llmJobs ?? [];
  const visibleLlmJobs = useMemo(
    () => backendLlmJobs.filter((job) => !job.mod_game || job.mod_game === gameId),
    [backendLlmJobs, gameId],
  );

  const importPendingCount = countPendingImports(activeImportJobs);

  const hasNoVisibleContent =
    !isModsLoading &&
    activeImportJobs.length === 0 &&
    sortedMods.length === 0 &&
    visibleNexusDownloads.length === 0 &&
    visibleAppJobs.length === 0 &&
    visibleLlmJobs.length === 0 &&
    upload.pendingModUploads.length === 0;

  if (modsError) {
    return (
      <div className={s.page}>
        <div className={`${s.center} ${s.error}`}>
          {t('common.error', { message: String(modsError) })}
        </div>
      </div>
    );
  }

  return (
    <div className={s.page}>
      <PageHeader title={t('mods.title')} description={t('mods.pageDescription')} />

      <ModsPageUploadBar
        fileRef={upload.fileRef}
        uploading={upload.uploading}
        pendingCount={importPendingCount}
        onUpload={() => void upload.handleUpload()}
        onStartAll={() => startAll(activeImportJobs)}
      />

      {isModsLoading && sortedMods.length === 0 && activeImportJobs.length === 0 ? (
        <div className={s.center}>{t('mods.loadingMods')}</div>
      ) : hasNoVisibleContent ? (
        <ModsPageEmptyState gameId={gameId} onUploadClick={upload.openFilePicker} />
      ) : (
        <ModsPageJobList
          pendingModUploads={upload.pendingModUploads}
          nexusDownloads={visibleNexusDownloads}
          appJobs={visibleAppJobs}
          llmJobs={visibleLlmJobs}
          activeImportJobs={activeImportJobs}
          sortedMods={sortedMods}
          liveProgress={liveProgress}
          importJobByModId={importJobByModId}
          importedModIds={importedModIds}
          srcLang={srcLang}
          targetLang={targetLang}
          selectedModIds={selection.selectedModIds}
          multiSelectActive={selection.multiSelectActive}
          allModsSelected={selection.allModsSelected}
          selectedModCount={selection.selectedModCount}
          clearingModId={deleteActions.clearingModId}
          deletingAll={deleteActions.deletingAll}
          batchMenuOpen={selection.batchMenuOpen}
          selectAllRef={selection.selectAllRef}
          batchMenuRef={selection.batchMenuRef}
          buildExportActions={buildExportActions}
          selectedModsForDelete={selection.selectedModsForDelete}
          onToggleSelectAll={selection.toggleSelectAllMods}
          onClearSelection={selection.clearModSelection}
          onToggleBatchMenu={(e) => {
            e.stopPropagation();
            selection.setBatchMenuOpen((v) => !v);
          }}
          onCloseBatchMenu={() => selection.setBatchMenuOpen(false)}
          onBatchDeleteAll={() =>
            deleteActions.requestDeleteMods(selection.selectedModsForDelete())
          }
          onBatchExportLangpack={() => {
            const modIds = selection.selectedModsForDelete().map((mod) => mod.id);
            void runBatchLangpackExport(modIds, srcLang, targetLang);
          }}
          exportingLangpack={exportingBatchLangpack}
          onImportStart={handleImportStart}
          onDeleteModJob={deleteActions.setDeleteModalJob}
          onDeleteSimpleJob={(kind, name, id) =>
            deleteActions.setDeleteSimpleJob({ kind, name, id })
          }
          onClearRows={(modId, name) => deleteActions.setPendingClear({ id: modId, name })}
          onDeleteAll={deleteActions.requestDeleteMods}
          onOpenMod={(modId) => nav(`/games/${gameId}/mods/${modId}`)}
          onOpenAiPanel={openModAiPanel}
          onToggleSelection={selection.toggleModSelection}
          onDeleteImport={deleteActions.setDeleteModalJob}
        />
      )}

      <ModsPageModals
        eetPreviewJob={eetPreviewJob}
        csvPreviewJob={csvPreviewJob}
        reimport={reimport}
        deleteModalJob={deleteActions.deleteModalJob}
        deletingModJobId={deleteActions.deletingModJobId}
        deleteSimpleJob={deleteActions.deleteSimpleJob}
        pendingClear={deleteActions.pendingClear}
        clearingModId={deleteActions.clearingModId}
        pendingDeleteAll={deleteActions.pendingDeleteAll}
        deletingAll={deleteActions.deletingAll}
        refreshAll={refreshAll}
        doStart={doStart}
        onCloseEetPreview={() => setEetPreviewId(null)}
        onCloseCsvPreview={() => setCsvPreviewId(null)}
        onCloseReimport={() => setReimport(null)}
        onCloseDeleteModal={() => deleteActions.setDeleteModalJob(null)}
        onConfirmDeleteMod={deleteActions.confirmDeleteMod}
        onCloseDeleteSimple={() => deleteActions.setDeleteSimpleJob(null)}
        onClosePendingClear={() => deleteActions.setPendingClear(null)}
        onConfirmClearRows={() => void deleteActions.confirmClearRows()}
        onClosePendingDeleteAll={() => deleteActions.setPendingDeleteAll(null)}
        onConfirmDeleteAll={() => void deleteActions.confirmDeleteAll()}
      />
    </div>
  );
};
