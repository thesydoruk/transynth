import type { ExportArchive, OpsLlmJob, Mod, ModImportJob } from '../../api';
import type { AppJob } from '../../appJobsQueue';
import type { NexusDownloadJob } from '../../nexusDownloadQueue';
import { NexusDownloadRow } from './NexusDownloadRow';
import { PendingUploadRow } from './PendingUploadRow';
import { AppJobRow } from './AppJobRow';
import { ExportArchiveRow } from './ExportArchiveRow';
import { LlmJobRow } from './LlmJobRow';
import { ModListHeader } from './ModListHeader';
import { ActiveImportJobsList } from './ActiveImportJobsList';
import { ModWorkspaceList } from './ModWorkspaceList';
import type { PendingModUpload, UnifiedJob } from './modsPageTypes';
import type { LiveProgress, ModExportAction } from './modsShared';
import s from './ModsPage.module.scss';

type ModsPageJobListProps = {
  pendingModUploads: PendingModUpload[];
  nexusDownloads: NexusDownloadJob[];
  appJobs: AppJob[];
  exportArchives: ExportArchive[];
  deletingExportId: number | null;
  onDownloadExport: (archive: ExportArchive) => void;
  onDeleteExport: (archive: ExportArchive) => void;
  llmJobs: OpsLlmJob[];
  activeImportJobs: UnifiedJob[];
  sortedMods: Mod[];
  liveProgress: Record<string, LiveProgress>;
  importJobByModId: Map<number, ModImportJob>;
  importedModIds: Set<number>;
  srcLang: string;
  targetLang: string;
  selectedModIds: Set<number>;
  multiSelectActive: boolean;
  allModsSelected: boolean;
  selectedModCount: number;
  clearingModId: number | null;
  deletingAll: boolean;
  batchMenuOpen: boolean;
  selectAllRef: React.RefObject<HTMLInputElement | null>;
  batchMenuRef: React.RefObject<HTMLDivElement | null>;
  buildExportActions: (
    modId: number,
    labelName: string,
    exportSrcLang: string,
    exportTgtLang: string,
    busyPrefix: string,
  ) => ModExportAction[];
  selectedModsForDelete: () => Array<{ id: number; name: string }>;
  onToggleSelectAll: () => void;
  onClearSelection: () => void;
  onToggleBatchMenu: (e: React.MouseEvent) => void;
  onCloseBatchMenu: () => void;
  onBatchDeleteAll: () => void;
  onBatchExportLangpack: () => void;
  exportingLangpack: boolean;
  onImportStart: (job: UnifiedJob) => void;
  onDeleteModJob: (job: ModImportJob) => void;
  onDeleteSimpleJob: (kind: 'eet' | 'csv', name: string, id: number) => void;
  onClearRows: (modId: number, name: string) => void;
  onDeleteAll: (mods: Array<{ id: number; name: string }>) => void;
  onOpenMod: (modId: number) => void;
  onOpenAiPanel: (modId: number) => void;
  onToggleSelection: (modId: number, selected: boolean) => void;
  onDeleteImport: (job: ModImportJob) => void;
};

export const ModsPageJobList = ({
  pendingModUploads,
  nexusDownloads,
  appJobs,
  exportArchives,
  deletingExportId,
  onDownloadExport,
  onDeleteExport,
  llmJobs,
  activeImportJobs,
  sortedMods,
  liveProgress,
  importJobByModId,
  importedModIds,
  srcLang,
  targetLang,
  selectedModIds,
  multiSelectActive,
  allModsSelected,
  selectedModCount,
  clearingModId,
  deletingAll,
  batchMenuOpen,
  selectAllRef,
  batchMenuRef,
  buildExportActions,
  selectedModsForDelete,
  onToggleSelectAll,
  onClearSelection,
  onToggleBatchMenu,
  onCloseBatchMenu,
  onBatchDeleteAll,
  onBatchExportLangpack,
  exportingLangpack,
  onImportStart,
  onDeleteModJob,
  onDeleteSimpleJob,
  onClearRows,
  onDeleteAll,
  onOpenMod,
  onOpenAiPanel,
  onToggleSelection,
  onDeleteImport,
}: ModsPageJobListProps) => (
  <div className={s.list}>
    {pendingModUploads.map((upload) => (
      <PendingUploadRow key={upload.id} upload={upload} />
    ))}

    {nexusDownloads.map((job) => (
      <NexusDownloadRow key={job.id} job={job} />
    ))}

    {appJobs.map((job) => (
      <AppJobRow key={job.id} job={job} />
    ))}

    {exportArchives.map((archive) => (
      <ExportArchiveRow
        key={`export-${archive.id}`}
        archive={archive}
        deleting={deletingExportId === archive.id}
        onDownload={() => onDownloadExport(archive)}
        onDelete={() => onDeleteExport(archive)}
      />
    ))}

    {llmJobs.map((job) => (
      <LlmJobRow key={`llm-${job.id}`} job={job} />
    ))}

    <ActiveImportJobsList
      jobs={activeImportJobs}
      liveProgress={liveProgress}
      importedModIds={importedModIds}
      srcLang={srcLang}
      targetLang={targetLang}
      clearingModId={clearingModId}
      deletingAll={deletingAll}
      buildExportActions={buildExportActions}
      onStart={onImportStart}
      onDeleteModJob={onDeleteModJob}
      onDeleteSimpleJob={onDeleteSimpleJob}
      onClearRows={onClearRows}
      onDeleteAll={onDeleteAll}
    />

    {sortedMods.length > 0 && (
      <ModListHeader
        selectAllRef={selectAllRef}
        allModsSelected={allModsSelected}
        selectedModCount={selectedModCount}
        multiSelectActive={multiSelectActive}
        deletingAll={deletingAll}
        batchMenuOpen={batchMenuOpen}
        batchMenuRef={batchMenuRef}
        onToggleSelectAll={onToggleSelectAll}
        onClearSelection={onClearSelection}
        onToggleBatchMenu={onToggleBatchMenu}
        onBatchDeleteAll={onBatchDeleteAll}
        onBatchExportLangpack={onBatchExportLangpack}
        onCloseBatchMenu={onCloseBatchMenu}
        exportingLangpack={exportingLangpack}
      />
    )}

    <ModWorkspaceList
      mods={sortedMods}
      importJobByModId={importJobByModId}
      srcLang={srcLang}
      targetLang={targetLang}
      selectedModIds={selectedModIds}
      multiSelectActive={multiSelectActive}
      clearingModId={clearingModId}
      deletingAll={deletingAll}
      buildExportActions={buildExportActions}
      selectedModsForDelete={selectedModsForDelete}
      onOpenMod={onOpenMod}
      onOpenAiPanel={onOpenAiPanel}
      onToggleSelection={onToggleSelection}
      onClearRows={onClearRows}
      onDeleteAll={onDeleteAll}
      onDeleteImport={onDeleteImport}
      onExportLangpack={onBatchExportLangpack}
      exportingLangpack={exportingLangpack}
    />
  </div>
);
