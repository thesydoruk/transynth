import { createContext, useContext } from 'react';
import type {
  ExportArchive,
  ModContentKind,
  ModImportJob,
  OpsLlmJob,
  PreviousVersionRow,
} from '../../api';
import type { AppJob } from '../../appJobsQueue';
import type { NexusDownloadJob } from '../../nexusDownloadQueue';
import type { useModDeleteActions, useModSelection } from './hooks';
import type { LiveProgress, ModExportAction } from './modsShared';
import type { PendingModUpload } from './modsPageTypes';

export type ModsWorkspace = {
  gameId: string;
  srcLang: string;
  targetLang: string;
  /** Vortex groups of the game; the source filter only exists when there are any. */
  vortexGroups: Array<{ id: number; label: string }>;
  /** Label of a Vortex group, undefined for manual uploads or an unknown group. */
  vortexGroupLabel: (groupId: number | null | undefined) => string | undefined;
  selection: ReturnType<typeof useModSelection>;
  deleteActions: ReturnType<typeof useModDeleteActions>;
  buildExportActions: (
    modId: number,
    labelName: string,
    exportSrcLang: string,
    exportTgtLang: string,
    busyPrefix: string,
  ) => ModExportAction[];
  /** Starts one langpack export for the selected mods. */
  exportSelected: () => void;
  exportingLangpack: boolean;
  importJobByModId: Map<number, ModImportJob>;
  importedModIds: Set<number>;
  activity: {
    pendingUploads: PendingModUpload[];
    nexusDownloads: NexusDownloadJob[];
    appJobs: AppJob[];
    llmJobs: OpsLlmJob[];
    importJobs: ModImportJob[];
    liveProgress: Record<number, LiveProgress>;
    onImportStart: (job: ModImportJob) => void;
  };
  exportArchives: {
    archives: ExportArchive[];
    deletingId: number | null;
    remove: (archive: ExportArchive) => Promise<void>;
  };
  upload: {
    fileRef: React.RefObject<HTMLInputElement | null>;
    uploading: boolean;
    pendingImportCount: number;
    onUpload: () => void;
    onStartAll: () => void;
    openFilePicker: () => void;
  };
  reimport: { newModId: number; prevVersions: PreviousVersionRow[] } | null;
  closeReimport: () => void;
  openMod: (modId: number) => void;
  openAiPanel: (modId: number) => void;
  /** Sets (or, with null, clears) the hand-picked content kind of a mod. */
  setContentKind: (modId: number, kind: ModContentKind | null) => Promise<void>;
};

export const ModsWorkspaceContext = createContext<ModsWorkspace | null>(null);

export const useModsWorkspace = (): ModsWorkspace => {
  const value = useContext(ModsWorkspaceContext);
  if (!value) throw new Error('useModsWorkspace must be used inside ModsWorkspaceContext');
  return value;
};
