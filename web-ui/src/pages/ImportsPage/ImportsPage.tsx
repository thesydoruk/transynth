/**
 * ImportsPage — single unified import list.
 *
 * All import types (EET, CSV, Mod) are shown in one combined list.
 * One upload bar accepts any supported file type and routes it to the
 * correct backend API based on file extension.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
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
import { CsvPreviewModal } from './CsvPreviewModal';
import { DeleteModConfirmModal } from './DeleteModConfirmModal/DeleteModConfirmModal';
import { EetPreviewModal } from './EetPreviewModal';
import { ModPreviewModal } from './ModPreviewModal';
import { ChangeLocaleModal } from './ChangeLocaleModal';
import { NexusDownloadRow } from './NexusDownloadRow';
import { UnifiedJobRow } from './UnifiedJobRow';
import { ConfirmModal } from '../../components/ConfirmModal';
import { statusColorBase, type LiveProgress } from './importsShared';
import s from './ImportPage.module.scss';

// ── Shared types & constants ───────────────────────────────────────────────────

/** Discriminated union wrapping every job type with a `kind` tag. */
type UnifiedJob =
  | { kind: 'eet'; job: EetImportJob }
  | { kind: 'csv'; job: CsvImportJob }
  | { kind: 'mod'; job: ModImportJob };

type SupportedGameId = 'fo4' | 'fo76' | 'fo3' | 'fnv' | 'ob' | 'mw' | 'sse' | 'sle';
type PendingModUpload = {
  id: string;
  fileName: string;
  phase: 'uploading' | 'extracting';
  percent: number;
};

/** All file extensions accepted by the unified upload input. */
const ACCEPTED_ALL = '.eet,.csv,.esp,.esm,.esl,.zip,.7z,.rar';

/** Determines the import kind from a file extension. */
const kindFromExt = (name: string): 'eet' | 'csv' | 'mod' | null => {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (ext === '.eet') return 'eet';
  if (ext === '.csv') return 'csv';
  if (['.esp', '.esm', '.esl', '.zip', '.7z', '.rar'].includes(ext)) return 'mod';
  return null;
};

/** Narrows a route gameId string to the API-supported game union. */
const isSupportedGameId = (value: string): value is SupportedGameId =>
  ['fo4', 'fo76', 'fo3', 'fnv', 'ob', 'mw', 'sse', 'sle'].includes(value);

/** Downloads a base64 payload produced by exportStrings/exportEsp/exportBa2 APIs. */
const downloadBase64File = (fileName: string, contentBase64: string) => {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

// ── Main page ─────────────────────────────────────────────────────────────────

/** Unified imports page — one upload bar, one combined job list. */
export const ImportsPage = () => {
  const { t } = useTranslation();
  const { gameId = 'fo4' } = useParams<{ gameId: string }>();
  const qc = useQueryClient();

  /* ── Queries — fetch all three job lists in parallel ───────────────────── */
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

  /* ── Merge into a single sorted list (newest first) ───────────────────── */
  const allJobs: UnifiedJob[] = [
    ...(eetJobs ?? []).map((job): UnifiedJob => ({ kind: 'eet', job })),
    ...(csvJobs ?? []).map((job): UnifiedJob => ({ kind: 'csv', job })),
    ...(modJobs ?? []).map((job): UnifiedJob => ({ kind: 'mod', job })),
  ].sort((a, b) => new Date(b.job.created_at).getTime() - new Date(a.job.created_at).getTime());

  /* ── Upload state ─────────────────────────────────────────────────────── */
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

  /* ── Nexus pre-import downloads (before backend job exists) ───────────── */
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

  /* ── Live progress for running imports (keyed by "kind:id") ───────────── */
  const [liveProgress, setLiveProgress] = useState<Record<string, LiveProgress>>({});
  const abortRefs = useRef<Record<string, AbortController>>({});

  /* ── Preview modals ───────────────────────────────────────────────────── */
  const [eetPreviewId, setEetPreviewId] = useState<number | null>(null);
  const [csvPreviewId, setCsvPreviewId] = useState<number | null>(null);
  const [modPreviewId, setModPreviewId] = useState<number | null>(null);
  const [changeLocaleJob, setChangeLocaleJob] = useState<ModImportJob | null>(null);

  /* ── Reimport detection — shown after a mod import completes ──────────── */
  /** State for the reimport modal: newModId + list of previous versions */
  const [reimport, setReimport] = useState<{
    newModId: number;
    prevVersions: PreviousVersionRow[];
  } | null>(null);
  const [exportBusy, setExportBusy] = useState<string | null>(null);
  const [deleteModalJob, setDeleteModalJob] = useState<ModImportJob | null>(null);
  const [deletingModJobId, setDeletingModJobId] = useState<number | null>(null);
  /** EET or CSV job queued for confirmation before deletion. */
  const [deleteSimpleJob, setDeleteSimpleJob] = useState<{
    kind: 'eet' | 'csv';
    name: string;
    id: number;
  } | null>(null);

  /** Invalidate all three import lists. */
  const refreshAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['eet-imports'] });
    qc.invalidateQueries({ queryKey: ['csv-imports'] });
    qc.invalidateQueries({ queryKey: ['mod-imports'] });
  }, [qc]);

  /* ── Start import by kind ─────────────────────────────────────────────── */
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
        // After a mod import finishes, check for previous versions of the same mod
        if (kind === 'mod') {
          // Re-fetch the job to get the assigned mod_id, then query previous versions
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
                  .catch(() => {
                    /* ignore */
                  });
              }
            })
            .catch(() => {
              /* ignore */
            });
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

  /* ── Upload handler — routes each file to the right API by extension ── */
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
          if (job) {
            // Start immediately with current/default languages.
            doStart('eet', job.id);
          }
        } else if (kind === 'csv') {
          const job = await api.csv.upload(f);
          if (job) {
            // Start immediately with current/default languages.
            doStart('csv', job.id);
          }
        } else {
          const uploadOptions = isSupportedGameId(gameId) ? { game: gameId } : undefined;
          const uploadId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          setPendingModUploads((prev) => [
            ...prev,
            {
              id: uploadId,
              fileName: f.name,
              phase: 'uploading',
              percent: 0,
            },
          ]);

          const onUploadProgress = (event: UploadProgressEvent) => {
            setPendingModUploads((prev) =>
              prev.map((row) => {
                if (row.id !== uploadId) return row;
                if (row.phase !== 'uploading') return row;
                return { ...row, percent: event.percent };
              }),
            );
          };

          const onExtractingStart = () => {
            setPendingModUploads((prev) =>
              prev.map((row) => {
                if (row.id !== uploadId) return row;
                return { ...row, phase: 'extracting', percent: 5 };
              }),
            );
          };

          const job = await api.modImport.upload(
            f,
            uploadOptions,
            onUploadProgress,
            onExtractingStart,
          );
          setPendingModUploads((prev) =>
            prev.map((row) => {
              if (row.id !== uploadId) return row;
              return { ...row, phase: 'extracting', percent: 100 };
            }),
          );
          if (job) {
            // Mod imports must be started manually after language is selected.
            refreshAll();
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

  /* ── Start all pending/paused/failed imports ──────────────────────────── */
  const startAll = () => {
    for (const u of allJobs) {
      if (['pending', 'paused', 'failed'].includes(u.job.status)) {
        // Mod imports require explicit language confirmation in the preview modal.
        if (u.kind === 'mod') continue;
        doStart(u.kind, u.job.id);
      }
    }
  };

  const pendingCount = allJobs.filter((u) =>
    ['pending', 'paused', 'failed'].includes(u.job.status),
  ).length;

  const runModExport = useCallback(
    async (modJob: ModImportJob, type: 'strings' | 'esp' | 'ba2' | 'zip') => {
      if (!modJob.mod_id) return;
      const busyKey = `${modJob.id}:${type}`;
      const appJobId = `export-${modJob.id}-${type}-${Date.now()}`;
      const now = Date.now();
      const label = `${modJob.file_name} · ${type.toUpperCase()} export`;
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
          const result = await api.mods.exportStrings(
            modJob.mod_id,
            modJob.src_lang,
            modJob.tgt_lang,
          );
          for (const file of result.files) downloadBase64File(file.fileName, file.contentBase64);
          upsertAppJob({
            id: appJobId,
            kind: 'export',
            label,
            status: 'completed',
            progress: 100,
            createdAt: now,
            updatedAt: Date.now(),
          });
          return;
        }
        if (type === 'esp') {
          const result = await api.mods.exportEsp(modJob.mod_id, modJob.src_lang, modJob.tgt_lang);
          for (const file of result.files) downloadBase64File(file.fileName, file.contentBase64);
          upsertAppJob({
            id: appJobId,
            kind: 'export',
            label,
            status: 'completed',
            progress: 100,
            createdAt: now,
            updatedAt: Date.now(),
          });
          return;
        }
        if (type === 'ba2') {
          const result = await api.mods.exportBa2(modJob.mod_id, modJob.src_lang, modJob.tgt_lang);
          for (const file of result.files) downloadBase64File(file.fileName, file.contentBase64);
          upsertAppJob({
            id: appJobId,
            kind: 'export',
            label,
            status: 'completed',
            progress: 100,
            createdAt: now,
            updatedAt: Date.now(),
          });
          return;
        }
        await api.mods.exportProject(modJob.mod_id, modJob.src_lang, modJob.tgt_lang);
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

  /* ── Resolve preview jobs from current data ───────────────────────────── */
  const eetPreviewJob =
    eetPreviewId != null ? (eetJobs ?? []).find((j) => j.id === eetPreviewId) : null;
  const csvPreviewJob =
    csvPreviewId != null ? (csvJobs ?? []).find((j) => j.id === csvPreviewId) : null;
  const modPreviewJob =
    modPreviewId != null ? (modJobs ?? []).find((j) => j.id === modPreviewId) : null;
  const visibleNexusDownloads = nexusDownloads.filter((d) => d.gameId === gameId);
  const visibleAppJobs = appJobs.filter((j) => j.status === 'running' || j.status === 'failed');
  /** Persisted LLM jobs from backend ops — shown for history visibility across reloads. */
  const backendLlmJobs: OpsLlmJob[] = opsData?.llmJobs ?? [];
  const hasNoVisibleJobs =
    allJobs.length === 0 &&
    visibleNexusDownloads.length === 0 &&
    visibleAppJobs.length === 0 &&
    backendLlmJobs.length === 0 &&
    pendingModUploads.length === 0;

  /** Confirms MOD deletion from custom modal and then refreshes import lists. */
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

  return (
    <div className={s.page}>
      <PageHeader title={t('imports.title')} description={t('imports.pageDescription')} />

      {/* Unified upload bar */}
      <div className={s.uploadBar}>
        <input ref={fileRef} type="file" accept={ACCEPTED_ALL} multiple className={s.fileInput} />
        <button onClick={handleUpload} disabled={uploading} className={s.btn}>
          {uploading ? t('common.uploading') : t('common.upload')}
        </button>
        {pendingCount > 0 && (
          <button onClick={startAll} className={s.btnImportAll}>
            {t('imports.importAll', { count: pendingCount })}
          </button>
        )}
      </div>

      {/* Unified job list + Nexus downloads still in progress */}
      {hasNoVisibleJobs ? (
        <div className={s.emptyState}>
          <h2 className={s.emptyTitle}>{t('imports.emptyTitle')}</h2>
          <p className={s.emptyText}>{t('imports.noFiles')}</p>
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
                <span className={s.typeBadge}>{'MOD'}</span>
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
            const kindBadge = job.kind === 'llm' ? 'LLM' : 'EXPORT';
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
                      {t(`importStatus.${job.status}`, job.status)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          {backendLlmJobs.map((job) => {
            const label = job.mod_name
              ? `LLM batch · ${job.mod_name}`
              : `LLM batch · mod ${job.mod_id ?? '?'}`;
            const pct =
              job.string_count > 0 ? Math.round((job.done_count / job.string_count) * 100) : null;
            return (
              <div key={`llm-${job.id}`} className={s.row}>
                <div className={s.rowLeft}>
                  <span className={s.typeBadge} style={{ background: '#1b6b2d' }}>
                    LLM
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
                      {t(`importStatus.${job.status}`, job.status)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          {allJobs.map((u) => {
            const key = `${u.kind}:${u.job.id}`;
            const live = liveProgress[key];
            const isRunning = u.job.running || !!live;
            const modJob = u.kind === 'mod' ? (u.job as ModImportJob) : null;
            const canExport = !!modJob?.mod_id && modJob.status === 'completed';
            const isModBusy =
              !!modJob && exportBusy != null && exportBusy.startsWith(`${modJob.id}:`);
            const exportActions = canExport
              ? [
                  {
                    key: 'strings' as const,
                    icon: '🧾',
                    title: t('modEditor.exportStringsTitle'),
                    onClick: () => {
                      void runModExport(modJob!, 'strings');
                    },
                    disabled: isModBusy,
                  },
                  {
                    key: 'esp' as const,
                    icon: '🧩',
                    title: t('modEditor.exportEspTitle'),
                    onClick: () => {
                      void runModExport(modJob!, 'esp');
                    },
                    disabled: isModBusy,
                  },
                  {
                    key: 'ba2' as const,
                    icon: '📦',
                    title: t('modEditor.exportBa2Title'),
                    onClick: () => {
                      void runModExport(modJob!, 'ba2');
                    },
                    disabled: isModBusy,
                  },
                  {
                    key: 'zip' as const,
                    icon: '⬇',
                    title: t('modEditor.exportZipTitle'),
                    onClick: () => {
                      void runModExport(modJob!, 'zip');
                    },
                    disabled: isModBusy,
                  },
                ]
              : [];

            return (
              <UnifiedJobRow
                key={key}
                kind={u.kind}
                job={u.job}
                live={live}
                isRunning={isRunning}
                exportActions={exportActions}
                onChangeLocale={
                  modJob?.mod_id && modJob.status === 'completed'
                    ? () => setChangeLocaleJob(modJob)
                    : undefined
                }
                onStart={() => {
                  if (u.kind === 'eet') setEetPreviewId(u.job.id);
                  else if (u.kind === 'csv') setCsvPreviewId(u.job.id);
                  else setModPreviewId(u.job.id);
                }}
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
        </div>
      )}

      {/* ── Preview modals (each type keeps its own) ──────────────────────── */}
      {eetPreviewJob && (
        <EetPreviewModal
          job={eetPreviewJob}
          onClose={() => setEetPreviewId(null)}
          onConfirm={async (srcLang, tgtLang) => {
            await api.eet.updateLanguages(eetPreviewJob.id, srcLang, tgtLang);
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
          onConfirm={async (srcLang, tgtLang) => {
            await api.csv.updateLanguages(csvPreviewJob.id, srcLang, tgtLang);
            refreshAll();
            setCsvPreviewId(null);
            setTimeout(() => doStart('csv', csvPreviewJob.id), 100);
          }}
        />
      )}
      {modPreviewJob && (
        <ModPreviewModal
          job={modPreviewJob}
          gameId={gameId}
          onClose={() => setModPreviewId(null)}
          onConfirm={async (payload) => {
            await api.modImport.updateLanguages(
              modPreviewJob.id,
              payload.importAllLocalizations ? 'en' : payload.importLang,
              modPreviewJob.tgt_lang,
            );
            refreshAll();
            setModPreviewId(null);

            // For localized imports with "import all" checked, skip the apply-to-mod step
            // and just run the normal import which will auto-convert all locales
            if (payload.importAllLocalizations) {
              if (modPreviewJob.status === 'completed') {
                await api.modImport.restart(modPreviewJob.id);
              }
              const importOk = await doStart('mod', modPreviewJob.id);
              if (!importOk) {
                return;
              }
              return;
            }

            if (payload.applyEnabled && payload.applyToModId != null) {
              await api.modImport.applyToMod(
                modPreviewJob.id,
                payload.applyToModId,
                payload.importLang,
              );
              refreshAll();
              return;
            }

            if (modPreviewJob.status === 'completed') {
              await api.modImport.restart(modPreviewJob.id);
            }

            const importOk = await doStart('mod', modPreviewJob.id);
            if (!importOk) {
              return;
            }
          }}
        />
      )}

      {/* ── Reimport modal — offer carry-over when a previous version exists ── */}
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
      {changeLocaleJob && (
        <ChangeLocaleModal
          job={changeLocaleJob}
          gameId={gameId}
          onClose={() => setChangeLocaleJob(null)}
        />
      )}
    </div>
  );
};
