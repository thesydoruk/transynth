/**
 * ModsPage — unified mod workspace for a game.
 *
 * Combines imported mod translation progress with import job management:
 * upload bar, active EET/CSV/mod imports, and imported mod rows with editor access.
 *
 * URL: /games/:gameId/mods
 */
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import {
  listNexusDownloadJobs,
  subscribeNexusDownloadJobs,
  type NexusDownloadJob,
} from '../../nexusDownloadQueue';
import { listAppJobs, subscribeAppJobs, upsertAppJob, type AppJob } from '../../appJobsQueue';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  api,
  type EetImportJob,
  type EetProgressEvent,
  type CsvImportJob,
  type CsvProgressEvent,
  type ModImportJob,
  type ModProgressEvent,
  type UploadProgressEvent,
  type PreviousVersionRow,
  type OpsLlmJob,
  type ModImportDeleteDataMode,
} from '../../api';
import { ReimportModal } from '../../components/ReimportModal';
import { ConfirmModal } from '../../components/ConfirmModal';
import { useToast } from '../../components/Toast';
import { CsvPreviewModal } from './CsvPreviewModal';
import { DeleteModConfirmModal } from './DeleteModConfirmModal/DeleteModConfirmModal';
import { EetPreviewModal } from './EetPreviewModal';
import { NexusDownloadRow } from './NexusDownloadRow';
import { UnifiedJobRow } from './UnifiedJobRow';
import {
  statusColorBase,
  type LiveProgress,
  canStartImportJob,
  isImportJobResume,
  importStatusKey,
} from './modsShared';
import {
  ACCEPTED_UPLOAD_EXTENSIONS,
  downloadBase64File,
  isActiveModImportJob,
  isSupportedGameId,
  kindFromExt,
} from './modsPageUtils';
import { ModWorkspaceRow } from './ModWorkspaceRow';
import { ModDataMenuItems } from './ModDataMenuItems';
import rowS from './UnifiedJobRow/UnifiedJobRow.module.scss';
import { useContentLangs } from '../../hooks/useContentLangs';
import { useModAiJobsPoll } from '../../hooks/useModAiJobsPoll';
import { getModAiJob } from '../../modAiJobsStore';
import {
  toggleModAiTranslate,
  toggleModAiTranslateTm,
  stopModAiTranslate,
} from '../../modAiTranslateRunner';
import { toggleModAiVoice } from '../../modAiVoiceRunner';
import { startModAiSkipDetect, stopModAiSkipDetect } from '../../modAiSkipDetectRunner';
import { modListQueryKey } from '../../langDefaults';
import s from './ModsPage.module.scss';

type UnifiedJob =
  | { kind: 'eet'; job: EetImportJob }
  | { kind: 'csv'; job: CsvImportJob }
  | { kind: 'mod'; job: ModImportJob };

type PendingModUpload = {
  id: string;
  fileName: string;
  phase: 'uploading' | 'extracting';
  percent: number;
};

export const ModsPage = () => {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { gameId = 'fo4' } = useParams<{ gameId: string }>();
  const qc = useQueryClient();
  const { srcLang, targetLang } = useContentLangs();
  useModAiJobsPoll(true);
  const { showToast } = useToast();

  const {
    data: mods,
    isLoading: isModsLoading,
    error: modsError,
  } = useQuery({
    queryKey: modListQueryKey(gameId, srcLang, targetLang),
    queryFn: () => api.mods.list(gameId, srcLang, targetLang),
  });

  const { data: eetJobs } = useQuery({
    queryKey: ['eet-imports'],
    queryFn: api.eet.list,
    refetchInterval: 3000,
  });
  const { data: csvJobs } = useQuery({
    queryKey: ['csv-imports'],
    queryFn: api.csv.list,
    refetchInterval: 3000,
  });
  const { data: modJobs } = useQuery({
    queryKey: ['mod-imports'],
    queryFn: api.modImport.list,
    refetchInterval: 3000,
  });
  const { data: opsData } = useQuery({
    queryKey: ['ops'],
    queryFn: api.ops.overview,
    refetchInterval: 5000,
  });

  const gameModJobs = useMemo(
    () => (modJobs ?? []).filter((job) => job.game === gameId),
    [modJobs, gameId],
  );

  const importJobByModId = useMemo(() => {
    const map = new Map<number, ModImportJob>();
    for (const job of gameModJobs) {
      if (job.mod_id == null || job.status !== 'completed') continue;
      const existing = map.get(job.mod_id);
      if (!existing || new Date(job.updated_at) > new Date(existing.updated_at)) {
        map.set(job.mod_id, job);
      }
    }
    return map;
  }, [gameModJobs]);

  const importedModIds = useMemo(() => new Set((mods ?? []).map((mod) => mod.id)), [mods]);

  const activeImportJobs: UnifiedJob[] = useMemo(
    () =>
      [
        ...(eetJobs ?? []).map((job): UnifiedJob => ({ kind: 'eet', job })),
        ...(csvJobs ?? []).map((job): UnifiedJob => ({ kind: 'csv', job })),
        ...gameModJobs
          .filter((job) => isActiveModImportJob(job, importedModIds))
          .map((job): UnifiedJob => ({ kind: 'mod', job })),
      ].sort((a, b) => new Date(b.job.created_at).getTime() - new Date(a.job.created_at).getTime()),
    [eetJobs, csvJobs, gameModJobs, importedModIds],
  );

  const sortedMods = useMemo(
    () => [...(mods ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [mods],
  );

  const [uploading, setUploading] = useState(false);
  const [pendingModUploads, setPendingModUploads] = useState<PendingModUpload[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const hasExtracting = pendingModUploads.some(
      (row) => row.phase === 'extracting' && row.percent < 95,
    );
    if (!hasExtracting) return;

    const timer = window.setInterval(() => {
      setPendingModUploads((prev) =>
        prev.map((row) => {
          if (row.phase !== 'extracting') return row;
          if (row.percent >= 95) return row;
          return { ...row, percent: Math.min(95, row.percent + 2) };
        }),
      );
    }, 250);

    return () => window.clearInterval(timer);
  }, [pendingModUploads]);

  const [nexusDownloads, setNexusDownloads] = useState<NexusDownloadJob[]>(() =>
    listNexusDownloadJobs(),
  );
  const [appJobs, setAppJobs] = useState<AppJob[]>(() => listAppJobs());

  useEffect(() => {
    const unsubscribe = subscribeNexusDownloadJobs(() => {
      setNexusDownloads(listNexusDownloadJobs());
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeAppJobs(() => {
      setAppJobs(listAppJobs());
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const [liveProgress, setLiveProgress] = useState<Record<string, LiveProgress>>({});
  const abortRefs = useRef<Record<string, AbortController>>({});

  const [eetPreviewId, setEetPreviewId] = useState<number | null>(null);
  const [csvPreviewId, setCsvPreviewId] = useState<number | null>(null);
  const [reimport, setReimport] = useState<{
    newModId: number;
    prevVersions: PreviousVersionRow[];
  } | null>(null);
  const [exportBusy, setExportBusy] = useState<string | null>(null);
  const [deleteModalJob, setDeleteModalJob] = useState<ModImportJob | null>(null);
  const [deletingModJobId, setDeletingModJobId] = useState<number | null>(null);
  const [deleteSimpleJob, setDeleteSimpleJob] = useState<{
    kind: 'eet' | 'csv';
    name: string;
    id: number;
  } | null>(null);
  const [pendingClear, setPendingClear] = useState<{ id: number; name: string } | null>(null);
  const [pendingDeleteAll, setPendingDeleteAll] = useState<{
    mods: Array<{ id: number; name: string }>;
  } | null>(null);
  const [clearingModId, setClearingModId] = useState<number | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [selectedModIds, setSelectedModIds] = useState<Set<number>>(() => new Set());
  const [batchMenuOpen, setBatchMenuOpen] = useState(false);
  const batchMenuRef = useRef<HTMLDivElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const selectedModCount = selectedModIds.size;
  const multiSelectActive = selectedModCount > 1;
  const allModsSelected = sortedMods.length > 0 && selectedModCount === sortedMods.length;
  const someModsSelected = selectedModCount > 0 && !allModsSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someModsSelected;
    }
  }, [someModsSelected]);

  useEffect(() => {
    if (!batchMenuOpen) return;
    const onDocClick = (ev: MouseEvent) => {
      if (!batchMenuRef.current?.contains(ev.target as Node)) {
        setBatchMenuOpen(false);
      }
    };
    window.addEventListener('click', onDocClick);
    return () => window.removeEventListener('click', onDocClick);
  }, [batchMenuOpen]);

  useEffect(() => {
    setSelectedModIds((prev) => {
      const valid = new Set(sortedMods.map((mod) => mod.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [sortedMods]);

  const toggleModSelection = useCallback((modId: number, selected: boolean) => {
    setSelectedModIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(modId);
      else next.delete(modId);
      return next;
    });
  }, []);

  const clearModSelection = useCallback(() => {
    setSelectedModIds(new Set());
  }, []);

  const toggleSelectAllMods = useCallback(() => {
    setSelectedModIds((prev) =>
      prev.size === sortedMods.length ? new Set() : new Set(sortedMods.map((mod) => mod.id)),
    );
  }, [sortedMods]);

  const selectedModsForDelete = useCallback(() => {
    const selected = sortedMods.filter((mod) => selectedModIds.has(mod.id));
    return selected.map((mod) => ({ id: mod.id, name: mod.name }));
  }, [sortedMods, selectedModIds]);

  const requestDeleteMods = useCallback((modsToDelete: Array<{ id: number; name: string }>) => {
    if (modsToDelete.length === 0) return;
    setPendingDeleteAll({ mods: modsToDelete });
  }, []);

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
                    if (prev.length > 0) setReimport({ newModId: job.mod_id!, prevVersions: prev });
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
    [refreshAll],
  );

  const handleUpload = async () => {
    const files = fileRef.current?.files;
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const kind = kindFromExt(f.name);
        if (!kind) continue;
        if (kind === 'eet') {
          const job = await api.eet.upload(f);
          if (job) doStart('eet', job.id);
        } else if (kind === 'csv') {
          const job = await api.csv.upload(f);
          if (job) doStart('csv', job.id);
        } else {
          const uploadOptions = isSupportedGameId(gameId) ? { game: gameId } : undefined;
          const uploadId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          setPendingModUploads((prev) => [
            ...prev,
            { id: uploadId, fileName: f.name, phase: 'uploading', percent: 0 },
          ]);

          const onUploadProgress = (event: UploadProgressEvent) => {
            setPendingModUploads((prev) =>
              prev.map((row) =>
                row.id === uploadId && row.phase === 'uploading'
                  ? { ...row, percent: event.percent }
                  : row,
              ),
            );
          };

          const onExtractingStart = () => {
            setPendingModUploads((prev) =>
              prev.map((row) =>
                row.id === uploadId ? { ...row, phase: 'extracting', percent: 5 } : row,
              ),
            );
          };

          const job = await api.modImport.upload(
            f,
            uploadOptions,
            onUploadProgress,
            onExtractingStart,
          );
          setPendingModUploads((prev) =>
            prev.map((row) =>
              row.id === uploadId ? { ...row, phase: 'extracting', percent: 100 } : row,
            ),
          );
          if (job) {
            refreshAll();
            void startModImportJob(job);
          }
          setPendingModUploads((prev) => prev.filter((row) => row.id !== uploadId));
        }
      }
      refreshAll();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

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
      if (u.kind === 'eet') setEetPreviewId(u.job.id);
      else if (u.kind === 'csv') setCsvPreviewId(u.job.id);
      else void startModImportJob(u.job);
    },
    [doStart, isImportJobRunning, startModImportJob],
  );

  const startAll = () => {
    for (const u of activeImportJobs) {
      if (!canStartImportJob(u.job, isImportJobRunning(u.kind, u.job.id, u.job.running), u.kind)) {
        continue;
      }
      if (u.kind === 'mod') void startModImportJob(u.job);
      else void doStart(u.kind, u.job.id);
    }
  };

  const pendingCount = activeImportJobs.filter((u) =>
    canStartImportJob(u.job, isImportJobRunning(u.kind, u.job.id, u.job.running), u.kind),
  ).length;

  const runModExport = useCallback(
    async (
      modId: number,
      exportSrcLang: string,
      exportTgtLang: string,
      labelName: string,
      type: 'strings' | 'esp' | 'pex' | 'ba2' | 'zip',
      busyKey: string,
    ) => {
      const appJobId = `export-${modId}-${type}-${Date.now()}`;
      const now = Date.now();
      const label = `${labelName} · ${type.toUpperCase()} export`;
      upsertAppJob({
        id: appJobId,
        kind: 'export',
        label,
        status: 'running',
        progress: 0,
        createdAt: now,
        updatedAt: now,
      });
      setExportBusy(busyKey);
      try {
        if (type === 'strings') {
          const result = await api.mods.exportStrings(modId, exportSrcLang, exportTgtLang);
          for (const file of result.files) downloadBase64File(file.fileName, file.contentBase64);
        } else if (type === 'esp') {
          const result = await api.mods.exportEsp(modId, exportSrcLang, exportTgtLang);
          for (const file of result.files) downloadBase64File(file.fileName, file.contentBase64);
        } else if (type === 'pex') {
          const result = await api.mods.exportPex(modId, exportSrcLang, exportTgtLang);
          for (const file of result.files) downloadBase64File(file.fileName, file.contentBase64);
        } else if (type === 'ba2') {
          const result = await api.mods.exportBa2(modId, exportSrcLang, exportTgtLang);
          for (const file of result.files) downloadBase64File(file.fileName, file.contentBase64);
        } else {
          await api.mods.exportProject(modId, exportSrcLang, exportTgtLang);
        }
        upsertAppJob({
          id: appJobId,
          kind: 'export',
          label,
          status: 'completed',
          progress: 100,
          createdAt: now,
          updatedAt: Date.now(),
        });
      } catch (err) {
        upsertAppJob({
          id: appJobId,
          kind: 'export',
          label,
          status: 'failed',
          progress: null,
          error: String(err),
          createdAt: now,
          updatedAt: Date.now(),
        });
        window.alert(String(err));
      } finally {
        setExportBusy(null);
      }
    },
    [],
  );

  const buildExportActions = useCallback(
    (
      modId: number,
      labelName: string,
      exportSrcLang: string,
      exportTgtLang: string,
      busyPrefix: string,
    ) => {
      const isBusy = exportBusy != null && exportBusy.startsWith(`${busyPrefix}:`);
      return [
        {
          key: 'strings' as const,
          icon: '🧾',
          title: t('modEditor.exportStringsTitle'),
          onClick: () => {
            void runModExport(
              modId,
              exportSrcLang,
              exportTgtLang,
              labelName,
              'strings',
              `${busyPrefix}:strings`,
            );
          },
          disabled: isBusy,
        },
        {
          key: 'esp' as const,
          icon: '🧩',
          title: t('modEditor.exportEspTitle'),
          onClick: () => {
            void runModExport(
              modId,
              exportSrcLang,
              exportTgtLang,
              labelName,
              'esp',
              `${busyPrefix}:esp`,
            );
          },
          disabled: isBusy,
        },
        {
          key: 'pex' as const,
          icon: '📜',
          title: t('modEditor.exportPexTitle'),
          onClick: () => {
            void runModExport(
              modId,
              exportSrcLang,
              exportTgtLang,
              labelName,
              'pex',
              `${busyPrefix}:pex`,
            );
          },
          disabled: isBusy,
        },
        {
          key: 'ba2' as const,
          icon: '📦',
          title: t('modEditor.exportBa2Title'),
          onClick: () => {
            void runModExport(
              modId,
              exportSrcLang,
              exportTgtLang,
              labelName,
              'ba2',
              `${busyPrefix}:ba2`,
            );
          },
          disabled: isBusy,
        },
        {
          key: 'zip' as const,
          icon: '⬇',
          title: t('modEditor.exportZipTitle'),
          onClick: () => {
            void runModExport(
              modId,
              exportSrcLang,
              exportTgtLang,
              labelName,
              'zip',
              `${busyPrefix}:zip`,
            );
          },
          disabled: isBusy,
        },
      ];
    },
    [exportBusy, runModExport, t],
  );

  const confirmClearRows = async () => {
    if (!pendingClear) return;
    setClearingModId(pendingClear.id);
    try {
      const result = await api.mods.clearRows(pendingClear.id);
      await refreshAll();
      showToast(t('mods.clearRowsSuccess', { count: result.deletedRecords }), 'success');
      setPendingClear(null);
    } catch (err) {
      showToast(t('common.error', { message: String(err) }), 'error');
    } finally {
      setClearingModId(null);
    }
  };

  const confirmDeleteAll = async () => {
    if (!pendingDeleteAll) return;
    const { mods: modsToDelete } = pendingDeleteAll;
    setDeletingAll(true);
    try {
      const result = await api.mods.removeBatch(modsToDelete.map((mod) => mod.id));
      if (result.deletedMods === 0) {
        throw new Error('No mods were deleted');
      }
      refreshAll();
      if (modsToDelete.length === 1) {
        showToast(t('mods.deleteAllSuccess', { name: modsToDelete[0].name }), 'success');
      } else {
        showToast(t('mods.deleteAllBatchSuccess', { count: result.deletedMods }), 'success');
      }
      setPendingDeleteAll(null);
      clearModSelection();
    } catch (err) {
      showToast(t('common.error', { message: String(err) }), 'error');
    } finally {
      setDeletingAll(false);
    }
  };

  const confirmDeleteMod = useCallback(
    async (deleteData: ModImportDeleteDataMode) => {
      if (!deleteModalJob) return;
      setDeletingModJobId(deleteModalJob.id);
      try {
        await api.modImport.remove(deleteModalJob.id, deleteData);
        setDeleteModalJob(null);
        refreshAll();
      } catch (err) {
        window.alert(String(err));
      } finally {
        setDeletingModJobId(null);
      }
    },
    [deleteModalJob, refreshAll],
  );

  const openModAiPanel = useCallback(
    (modId: number, panel: 'ai-verify') => {
      nav(`/games/${gameId}/mods/${modId}?open=${panel}`);
    },
    [gameId, nav],
  );

  const eetPreviewJob =
    eetPreviewId != null ? (eetJobs ?? []).find((j) => j.id === eetPreviewId) : null;
  const csvPreviewJob =
    csvPreviewId != null ? (csvJobs ?? []).find((j) => j.id === csvPreviewId) : null;
  const visibleNexusDownloads = nexusDownloads.filter((d) => d.gameId === gameId);
  const visibleAppJobs = appJobs.filter((j) => j.status === 'running' || j.status === 'failed');
  const backendLlmJobs: OpsLlmJob[] = opsData?.llmJobs ?? [];
  const visibleLlmJobs = useMemo(
    () => backendLlmJobs.filter((job) => !job.mod_game || job.mod_game === gameId),
    [backendLlmJobs, gameId],
  );

  const hasNoVisibleContent =
    !isModsLoading &&
    activeImportJobs.length === 0 &&
    sortedMods.length === 0 &&
    visibleNexusDownloads.length === 0 &&
    visibleAppJobs.length === 0 &&
    visibleLlmJobs.length === 0 &&
    pendingModUploads.length === 0;

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

      <div className={s.uploadBar}>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED_UPLOAD_EXTENSIONS}
          multiple
          className={s.fileInput}
        />
        <button onClick={handleUpload} disabled={uploading} className={s.btn}>
          {uploading ? t('common.uploading') : t('common.upload')}
        </button>
        {pendingCount > 0 && (
          <button onClick={startAll} className={s.btnImportAll}>
            {t('imports.importAll', { count: pendingCount })}
          </button>
        )}
      </div>

      {isModsLoading && sortedMods.length === 0 && activeImportJobs.length === 0 ? (
        <div className={s.center}>{t('mods.loadingMods')}</div>
      ) : hasNoVisibleContent ? (
        <div className={s.emptyState}>
          <h2 className={s.emptyTitle}>{t('mods.noModsFound')}</h2>
          <p className={s.emptyText}>{t('mods.noModsHint')}</p>
          <div className={s.emptyActions}>
            <button onClick={() => fileRef.current?.click()} className={s.btn}>
              {t('imports.emptyUploadAction')}
            </button>
            <Link to={`/games/${gameId}/nexus`} className={s.emptyLinkBtn}>
              {t('imports.emptyDiscoverAction')}
            </Link>
          </div>
        </div>
      ) : (
        <div className={s.list}>
          {pendingModUploads.map((u) => (
            <div key={u.id} className={`${s.row} ${s.pendingUploadRow}`}>
              <div className={s.rowLeft}>
                <span className={s.typeBadge}>MOD</span>
                <div>
                  <span className={s.fileName}>{u.fileName}</span>
                  <span className={s.meta}>
                    <span
                      className={
                        u.phase === 'uploading' ? s.phaseChipUploading : s.phaseChipExtracting
                      }
                    >
                      {u.phase === 'uploading'
                        ? t('common.uploading')
                        : t('importStatus.extracting')}
                    </span>
                  </span>
                </div>
              </div>
              <div className={s.rowRight}>
                <div className={s.progressWrap}>
                  <div className={s.progressTrack}>
                    <div
                      className={
                        u.phase === 'uploading' ? s.progressFill : s.progressFillExtracting
                      }
                      style={{ width: `${u.percent}%` }}
                    />
                  </div>
                  <span className={s.progressLabel}>{`${u.percent}%`}</span>
                </div>
              </div>
            </div>
          ))}

          {visibleNexusDownloads.map((d) => (
            <NexusDownloadRow key={d.id} job={d} />
          ))}

          {visibleAppJobs.map((job) => {
            const pct =
              job.progress == null ? null : Math.max(0, Math.min(100, Math.round(job.progress)));
            const kindBadge = job.kind === 'llm' ? t('imports.llmBadge') : t('imports.exportBadge');
            return (
              <div key={job.id} className={s.row}>
                <div className={s.rowLeft}>
                  <span
                    className={s.typeBadge}
                    style={{ background: job.kind === 'llm' ? '#1b6b2d' : '#1565c0' }}
                  >
                    {kindBadge}
                  </span>
                  <div>
                    <span className={s.fileName}>{job.label}</span>
                    <span className={s.meta}>{new Date(job.updatedAt).toLocaleString()}</span>
                  </div>
                </div>
                <div className={s.rowRight}>
                  {pct == null ? (
                    <span className={s.progressLabel}>—</span>
                  ) : (
                    <div className={s.progressWrap}>
                      <div className={s.progressTrack}>
                        <div className={s.progressFill} style={{ width: `${pct}%` }} />
                      </div>
                      <span className={s.progressLabel}>{pct}%</span>
                    </div>
                  )}
                  <div className={s.actions}>
                    <span
                      className={s.badge}
                      style={{
                        background: statusColorBase(
                          job.status === 'running' ? 'in_progress' : 'failed',
                        ),
                      }}
                    >
                      {t(`importStatus.${importStatusKey(job.status)}`, job.status)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {visibleLlmJobs.map((job) => {
            const label = job.mod_name
              ? t('imports.llmBatchName', { name: job.mod_name })
              : t('imports.llmBatchMod', { id: job.mod_id ?? '?' });
            const pct =
              job.string_count > 0 ? Math.round((job.done_count / job.string_count) * 100) : null;
            return (
              <div key={`llm-${job.id}`} className={s.row}>
                <div className={s.rowLeft}>
                  <span className={s.typeBadge} style={{ background: '#1b6b2d' }}>
                    {t('imports.llmBadge')}
                  </span>
                  <div>
                    <span className={s.fileName}>{label}</span>
                    <span className={s.meta}>{new Date(job.updated_at).toLocaleString()}</span>
                  </div>
                </div>
                <div className={s.rowRight}>
                  {pct == null ? (
                    <span className={s.progressLabel}>—</span>
                  ) : (
                    <div className={s.progressWrap}>
                      <div className={s.progressTrack}>
                        <div className={s.progressFill} style={{ width: `${pct}%` }} />
                      </div>
                      <span className={s.progressLabel}>
                        {job.done_count}/{job.string_count} ({pct}%)
                      </span>
                    </div>
                  )}
                  <div className={s.actions}>
                    <span
                      className={s.badge}
                      style={{
                        background: statusColorBase(
                          job.status === 'running'
                            ? 'in_progress'
                            : job.status === 'completed'
                              ? 'completed'
                              : 'failed',
                        ),
                      }}
                    >
                      {t(`importStatus.${importStatusKey(job.status)}`, job.status)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {activeImportJobs.map((u) => {
            const key = `${u.kind}:${u.job.id}`;
            const live = liveProgress[key];
            const isRunning = u.job.running || !!live;
            const modJob = u.kind === 'mod' ? u.job : null;
            const orphanedCompletedMod =
              !!modJob?.mod_id &&
              modJob.status === 'completed' &&
              !importedModIds.has(modJob.mod_id);
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
                        onClearRows: () =>
                          setPendingClear({ id: modJob.mod_id!, name: modJob.file_name }),
                        onDeleteAll: () =>
                          requestDeleteMods([{ id: modJob.mod_id!, name: modJob.file_name }]),
                        clearingRows: clearingModId === modJob.mod_id,
                        deletingAll,
                      }
                    : undefined
                }
                onStart={() => handleImportStart(u)}
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
                    setDeleteModalJob(u.job as ModImportJob);
                    return;
                  }
                  setDeleteSimpleJob({ kind: u.kind, name: u.job.file_name, id: u.job.id });
                }}
              />
            );
          })}

          {sortedMods.length > 0 && (
            <div className={s.modListHeader}>
              <label className={s.selectAllLabel}>
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allModsSelected}
                  onChange={toggleSelectAllMods}
                  disabled={deletingAll}
                />
                {selectedModCount > 0
                  ? t('mods.selectedCount', { count: selectedModCount })
                  : t('mods.selectAll')}
              </label>
              {selectedModCount > 0 && (
                <>
                  <button
                    type="button"
                    className={s.selectionBtn}
                    onClick={clearModSelection}
                    disabled={deletingAll}
                  >
                    {t('mods.clearSelection')}
                  </button>
                  {multiSelectActive && (
                    <div className={rowS.menuWrap} ref={batchMenuRef}>
                      <button
                        type="button"
                        className={s.selectionBtn}
                        disabled={deletingAll}
                        onClick={(e) => {
                          e.stopPropagation();
                          setBatchMenuOpen((v) => !v);
                        }}
                      >
                        {t('mods.batchActions')} ⋯
                      </button>
                      {batchMenuOpen && (
                        <div className={rowS.menuList}>
                          <ModDataMenuItems
                            deletingAll={deletingAll}
                            batchOnly
                            onClearRows={() => {}}
                            onDeleteAll={() => {
                              requestDeleteMods(selectedModsForDelete());
                              setBatchMenuOpen(false);
                            }}
                            onAfterAction={() => setBatchMenuOpen(false)}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {sortedMods.map((mod) => {
            const importJob = importJobByModId.get(mod.id) ?? null;
            const exportActions = buildExportActions(
              mod.id,
              mod.name,
              srcLang,
              targetLang,
              `mod-${mod.id}`,
            );
            const isSelected = selectedModIds.has(mod.id);

            return (
              <ModWorkspaceRow
                key={`mod-${mod.id}`}
                mod={mod}
                importJob={importJob}
                exportActions={exportActions}
                clearingRows={clearingModId === mod.id}
                deletingAll={deletingAll}
                selected={isSelected}
                multiSelectActive={multiSelectActive}
                onSelectedChange={(selected) => toggleModSelection(mod.id, selected)}
                onOpen={() => nav(`/games/${gameId}/mods/${mod.id}`)}
                onAiTranslateTm={() =>
                  toggleModAiTranslateTm(
                    mod.id,
                    srcLang,
                    targetLang,
                    getModAiJob(mod.id, 'translate'),
                  )
                }
                onAiTranslateLlm={() =>
                  toggleModAiTranslate(
                    mod.id,
                    srcLang,
                    targetLang,
                    getModAiJob(mod.id, 'translate'),
                  )
                }
                onAiTranslateStop={() =>
                  void stopModAiTranslate(mod.id, getModAiJob(mod.id, 'translate'))
                }
                onAiVerify={() => openModAiPanel(mod.id, 'ai-verify')}
                onSkipDetectHeuristic={() =>
                  void startModAiSkipDetect(
                    mod.id,
                    srcLang,
                    false,
                    getModAiJob(mod.id, 'skip-detect'),
                  )
                }
                onSkipDetectWithLlm={() =>
                  void startModAiSkipDetect(
                    mod.id,
                    srcLang,
                    true,
                    getModAiJob(mod.id, 'skip-detect'),
                  )
                }
                onSkipDetectStop={() =>
                  void stopModAiSkipDetect(mod.id, getModAiJob(mod.id, 'skip-detect').jobId)
                }
                onAiVoice={() =>
                  toggleModAiVoice(mod.id, srcLang, targetLang, getModAiJob(mod.id, 'voice'))
                }
                onClearRows={() => setPendingClear({ id: mod.id, name: mod.name })}
                onDeleteAll={() =>
                  requestDeleteMods(
                    multiSelectActive && isSelected
                      ? selectedModsForDelete()
                      : [{ id: mod.id, name: mod.name }],
                  )
                }
                onReimport={importJob ? () => void startModImportJob(importJob) : undefined}
                onDeleteImport={importJob ? () => setDeleteModalJob(importJob) : undefined}
              />
            );
          })}
        </div>
      )}

      {eetPreviewJob && (
        <EetPreviewModal
          job={eetPreviewJob}
          onClose={() => setEetPreviewId(null)}
          onConfirm={async (previewSrcLang, previewTgtLang) => {
            await api.eet.updateLanguages(eetPreviewJob.id, previewSrcLang, previewTgtLang);
            refreshAll();
            setEetPreviewId(null);
            setTimeout(() => doStart('eet', eetPreviewJob.id), 100);
          }}
        />
      )}
      {csvPreviewJob && (
        <CsvPreviewModal
          job={csvPreviewJob}
          onClose={() => setCsvPreviewId(null)}
          onConfirm={async (previewSrcLang, previewTgtLang) => {
            await api.csv.updateLanguages(csvPreviewJob.id, previewSrcLang, previewTgtLang);
            refreshAll();
            setCsvPreviewId(null);
            setTimeout(() => doStart('csv', csvPreviewJob.id), 100);
          }}
        />
      )}

      {reimport && (
        <ReimportModal
          newModId={reimport.newModId}
          prevVersions={reimport.prevVersions}
          onClose={() => setReimport(null)}
        />
      )}

      {deleteModalJob && (
        <DeleteModConfirmModal
          fileName={deleteModalJob.file_name}
          deleting={deletingModJobId === deleteModalJob.id}
          onClose={() => setDeleteModalJob(null)}
          onConfirm={(deleteData) => {
            void confirmDeleteMod(deleteData);
          }}
        />
      )}

      {deleteSimpleJob && (
        <ConfirmModal
          title={t('imports.deleteJobTitle')}
          message={t('imports.deleteJobMessage', { name: deleteSimpleJob.name })}
          confirmLabel={t('common.delete')}
          onClose={() => setDeleteSimpleJob(null)}
          onConfirm={() => {
            const { kind, id } = deleteSimpleJob;
            const p = kind === 'eet' ? api.eet.remove(id) : api.csv.remove(id);
            p.then(refreshAll);
            setDeleteSimpleJob(null);
          }}
        />
      )}

      {pendingClear && (
        <ConfirmModal
          title={t('mods.clearRowsTitle')}
          message={t('mods.clearRowsMessage', { name: pendingClear.name })}
          confirmLabel={t('mods.clearRows')}
          pending={clearingModId === pendingClear.id}
          onClose={() => setPendingClear(null)}
          onConfirm={() => {
            void confirmClearRows();
          }}
        />
      )}

      {pendingDeleteAll && (
        <ConfirmModal
          title={
            pendingDeleteAll.mods.length === 1
              ? t('mods.deleteAllTitle')
              : t('mods.deleteAllBatchTitle')
          }
          message={
            pendingDeleteAll.mods.length === 1
              ? t('mods.deleteAllMessage', { name: pendingDeleteAll.mods[0].name })
              : t('mods.deleteAllBatchMessage', { count: pendingDeleteAll.mods.length })
          }
          confirmLabel={t('mods.deleteAll')}
          pending={deletingAll}
          onClose={() => setPendingDeleteAll(null)}
          onConfirm={() => {
            void confirmDeleteAll();
          }}
        />
      )}
    </div>
  );
};
