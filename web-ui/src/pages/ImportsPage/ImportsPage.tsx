/**
 * ImportsPage — single unified import list.
 *
 * All import types (EET, CSV, Mod) are shown in one combined list.
 * One upload bar accepts any supported file type and routes it to the
 * correct backend API based on file extension.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  listNexusDownloadJobs,
  subscribeNexusDownloadJobs,
  type NexusDownloadJob,
} from '../../nexusDownloadQueue';
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
  type PreviousVersionRow,
} from '../../api';
import { ReimportModal } from '../../components/ReimportModal';
import { CsvPreviewModal } from './CsvPreviewModal';
import { DeleteModConfirmModal } from './DeleteModConfirmModal/DeleteModConfirmModal';
import { EetPreviewModal } from './EetPreviewModal';
import { ModPreviewModal } from './ModPreviewModal';
import { NexusDownloadRow } from './NexusDownloadRow';
import { UnifiedJobRow } from './UnifiedJobRow';
import { type LiveProgress } from './importsShared';
import s from './ImportPage.module.scss';

// ── Shared types & constants ───────────────────────────────────────────────────

/** Discriminated union wrapping every job type with a `kind` tag. */
type UnifiedJob =
  | { kind: 'eet'; job: EetImportJob }
  | { kind: 'csv'; job: CsvImportJob }
  | { kind: 'mod'; job: ModImportJob };

type SupportedGameId = 'fo4' | 'fo76' | 'fo3' | 'fnv' | 'sse' | 'sle';

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
  ['fo4', 'fo76', 'fo3', 'fnv', 'sse', 'sle'].includes(value);

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
  const { data: eetJobs } = useQuery({ queryKey: ['eet-imports'], queryFn: api.eet.list, refetchInterval: 3000 });
  const { data: csvJobs } = useQuery({ queryKey: ['csv-imports'], queryFn: api.csv.list, refetchInterval: 3000 });
  const { data: modJobs } = useQuery({ queryKey: ['mod-imports'], queryFn: api.modImport.list, refetchInterval: 3000 });

  /* ── Merge into a single sorted list (newest first) ───────────────────── */
  const allJobs: UnifiedJob[] = [
    ...(eetJobs ?? []).map((job): UnifiedJob => ({ kind: 'eet', job })),
    ...(csvJobs ?? []).map((job): UnifiedJob => ({ kind: 'csv', job })),
    ...(modJobs ?? []).map((job): UnifiedJob => ({ kind: 'mod', job })),
  ].sort((a, b) => new Date(b.job.created_at).getTime() - new Date(a.job.created_at).getTime());

  /* ── Upload state ─────────────────────────────────────────────────────── */
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /* ── Nexus pre-import downloads (before backend job exists) ───────────── */
  const [nexusDownloads, setNexusDownloads] = useState<NexusDownloadJob[]>(() => listNexusDownloadJobs());

  useEffect(() => {
    const unsubscribe = subscribeNexusDownloadJobs(() => {
      setNexusDownloads(listNexusDownloadJobs());
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

  /* ── Reimport detection — shown after a mod import completes ──────────── */
  /** State for the reimport modal: newModId + list of previous versions */
  const [reimport, setReimport] = useState<{ newModId: number; prevVersions: PreviousVersionRow[] } | null>(null);
  const [exportBusy, setExportBusy] = useState<string | null>(null);
  const [deleteModalJob, setDeleteModalJob] = useState<ModImportJob | null>(null);
  const [deletingModJobId, setDeletingModJobId] = useState<number | null>(null);

  /** Invalidate all three import lists. */
  const refreshAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['eet-imports'] });
    qc.invalidateQueries({ queryKey: ['csv-imports'] });
    qc.invalidateQueries({ queryKey: ['mod-imports'] });
  }, [qc]);

  /* ── Start import by kind ─────────────────────────────────────────────── */
  const doStart = useCallback((kind: 'eet' | 'csv' | 'mod', jobId: number): Promise<boolean> => {
    const key = `${kind}:${jobId}`;
    const onProgress = (e: { imported: number; total: number }) => {
      setLiveProgress(prev => ({ ...prev, [key]: { imported: e.imported, total: e.total } }));
    };
    const cleanup = () => {
      setLiveProgress(prev => { const c = { ...prev }; delete c[key]; return c; });
      delete abortRefs.current[key];
      refreshAll();
      // After a mod import finishes, check for previous versions of the same mod
      if (kind === 'mod') {
        // Re-fetch the job to get the assigned mod_id, then query previous versions
        api.modImport.list().then((jobs) => {
          const job = jobs.find((j) => j.id === jobId);
          if (job?.mod_id != null) {
            api.mods.previousVersions(job.mod_id).then((prev) => {
              if (prev.length > 0) setReimport({ newModId: job.mod_id!, prevVersions: prev });
            }).catch(() => {/* ignore */});
          }
        }).catch(() => {/* ignore */});
      }
    };

    let promise: Promise<unknown>;
    let abort: AbortController;

    if (kind === 'eet') {
      const r = api.eet.startImport(jobId, onProgress as (e: EetProgressEvent) => void);
      promise = r.promise; abort = r.abort;
    } else if (kind === 'csv') {
      const r = api.csv.startImport(jobId, onProgress as (e: CsvProgressEvent) => void);
      promise = r.promise; abort = r.abort;
    } else {
      const r = api.modImport.startImport(jobId, onProgress as (e: ModProgressEvent) => void);
      promise = r.promise; abort = r.abort;
    }

    abortRefs.current[key] = abort;
    const done = promise.then(() => {
      cleanup();
      return true;
    }).catch(() => {
      cleanup();
      return false;
    });
    refreshAll();
    return done;
  }, [refreshAll]);

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
          const job = await api.modImport.upload(f, uploadOptions);
          if (job) {
            // Mod imports must be started manually after language is selected.
            refreshAll();
          }
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

  const pendingCount = allJobs.filter(u => ['pending', 'paused', 'failed'].includes(u.job.status)).length;

  const runModExport = useCallback(
    async (
      modJob: ModImportJob,
      type: 'strings' | 'esp' | 'ba2' | 'zip',
    ) => {
      if (!modJob.mod_id) return;
      const busyKey = `${modJob.id}:${type}`;
      setExportBusy(busyKey);
      try {
        if (type === 'strings') {
          const result = await api.mods.exportStrings(modJob.mod_id, modJob.src_lang, modJob.tgt_lang);
          for (const file of result.files) downloadBase64File(file.fileName, file.contentBase64);
          return;
        }
        if (type === 'esp') {
          const result = await api.mods.exportEsp(modJob.mod_id, modJob.src_lang, modJob.tgt_lang);
          for (const file of result.files) downloadBase64File(file.fileName, file.contentBase64);
          return;
        }
        if (type === 'ba2') {
          const result = await api.mods.exportBa2(modJob.mod_id, modJob.src_lang, modJob.tgt_lang);
          for (const file of result.files) downloadBase64File(file.fileName, file.contentBase64);
          return;
        }
        await api.mods.exportProject(modJob.mod_id, modJob.src_lang, modJob.tgt_lang);
      } catch (err) {
        window.alert(String(err));
      } finally {
        setExportBusy(null);
      }
    },
    [],
  );

  /* ── Resolve preview jobs from current data ───────────────────────────── */
  const eetPreviewJob = eetPreviewId != null ? (eetJobs ?? []).find(j => j.id === eetPreviewId) : null;
  const csvPreviewJob = csvPreviewId != null ? (csvJobs ?? []).find(j => j.id === csvPreviewId) : null;
  const modPreviewJob = modPreviewId != null ? (modJobs ?? []).find(j => j.id === modPreviewId) : null;
  const visibleNexusDownloads = nexusDownloads.filter((d) => d.gameId === gameId);

  /** Confirms MOD deletion from custom modal and then refreshes import lists. */
  const confirmDeleteMod = useCallback(async () => {
    if (!deleteModalJob) return;
    setDeletingModJobId(deleteModalJob.id);
    try {
      await api.modImport.remove(deleteModalJob.id);
      setDeleteModalJob(null);
      refreshAll();
    } catch (err) {
      window.alert(String(err));
    } finally {
      setDeletingModJobId(null);
    }
  }, [deleteModalJob, refreshAll]);

  return (
    <div className={s.page}>
      <h1 className={s.title}>{t('imports.title')}</h1>

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
      {allJobs.length === 0 && visibleNexusDownloads.length === 0 ? (
        <p className={s.empty}>{t('imports.noFiles')}</p>
      ) : (
        <div className={s.list}>
          {visibleNexusDownloads.map((d) => (
            <NexusDownloadRow key={d.id} job={d} />
          ))}
          {allJobs.map(u => {
            const key = `${u.kind}:${u.job.id}`;
            const live = liveProgress[key];
            const isRunning = u.job.running || !!live;
            const modJob = u.kind === 'mod' ? (u.job as ModImportJob) : null;
            const canExport = !!modJob?.mod_id && modJob.status === 'completed';
            const isModBusy = !!modJob && exportBusy != null && exportBusy.startsWith(`${modJob.id}:`);
            const exportActions = canExport ? [
              {
                key: 'strings' as const,
                icon: '🧾',
                title: t('modEditor.exportStringsTitle'),
                onClick: () => { void runModExport(modJob!, 'strings'); },
                disabled: isModBusy,
              },
              {
                key: 'esp' as const,
                icon: '🧩',
                title: t('modEditor.exportEspTitle'),
                onClick: () => { void runModExport(modJob!, 'esp'); },
                disabled: isModBusy,
              },
              {
                key: 'ba2' as const,
                icon: '📦',
                title: t('modEditor.exportBa2Title'),
                onClick: () => { void runModExport(modJob!, 'ba2'); },
                disabled: isModBusy,
              },
              {
                key: 'zip' as const,
                icon: '⬇',
                title: t('modEditor.exportZipTitle'),
                onClick: () => { void runModExport(modJob!, 'zip'); },
                disabled: isModBusy,
              },
            ] : [];

            return (
              <UnifiedJobRow
                key={key}
                kind={u.kind}
                job={u.job}
                live={live}
                isRunning={isRunning}
                exportActions={exportActions}
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
                  const p = u.kind === 'eet'
                    ? api.eet.remove(u.job.id)
                    : api.csv.remove(u.job.id);
                  p.then(refreshAll);
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
              payload.importLang,
              payload.importLang,
            );
            refreshAll();
            setModPreviewId(null);

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
          onConfirm={() => { void confirmDeleteMod(); }}
        />
      )}
    </div>
  );
};

