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
} from '../nexusDownloadQueue';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  api,
  type EetImportJob,
  type EetProgressEvent,
  type EetPreviewRow,
  type CsvImportJob,
  type CsvProgressEvent,
  type CsvPreviewRow,
  type ModImportJob,
  type ModProgressEvent,
  type ModPreviewRow,
  type PreviousVersionRow,
} from '../api';
import { ReimportModal } from '../components/ReimportModal';
import s from './ImportPage.module.scss';

// ── Shared types & constants ───────────────────────────────────────────────────

/** Live SSE progress for a running import. */
type LiveProgress = { imported: number; total: number };

/** Discriminated union wrapping every job type with a `kind` tag. */
type UnifiedJob =
  | { kind: 'eet'; job: EetImportJob }
  | { kind: 'csv'; job: CsvImportJob }
  | { kind: 'mod'; job: ModImportJob };

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

/** Language options shared by all import preview modals. */
const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'ru', label: 'Russian' },
  { code: 'de', label: 'German' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'pl', label: 'Polish' },
  { code: 'ja', label: 'Japanese' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ko', label: 'Korean' },
];

/** Background color for a job status badge. */
const statusColorBase = (status: string): string => {
  switch (status) {
    case 'pending':     return '#555';
    case 'extracting':  return '#6a1b9a';
    case 'in_progress': return '#1565c0';
    case 'paused':      return '#e65100';
    case 'failed':      return '#b71c1c';
    case 'completed':   return '#1b6b2d';
    default:            return '#555';
  }
};

/** Color for the type badge in the unified list. */
const kindColor = (kind: 'eet' | 'csv' | 'mod'): string => {
  switch (kind) {
    case 'eet': return '#6a1b9a';
    case 'csv': return '#1565c0';
    case 'mod': return '#e65100';
  }
};

/** Translated status label for a job. */
const statusLabel = (status: string, t: (key: string) => string): string =>
  t(`importStatus.${status}`) || status;

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
    return subscribeNexusDownloadJobs(() => {
      setNexusDownloads(listNexusDownloadJobs());
    });
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

  /** Invalidate all three import lists. */
  const refreshAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['eet-imports'] });
    qc.invalidateQueries({ queryKey: ['csv-imports'] });
    qc.invalidateQueries({ queryKey: ['mod-imports'] });
  }, [qc]);

  /* ── Start import by kind ─────────────────────────────────────────────── */
  const doStart = useCallback((kind: 'eet' | 'csv' | 'mod', jobId: number) => {
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
    promise.then(cleanup).catch(cleanup);
    refreshAll();
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
          const job = await api.modImport.upload(f, { game: gameId });
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

  /* ── Resolve preview jobs from current data ───────────────────────────── */
  const eetPreviewJob = eetPreviewId != null ? (eetJobs ?? []).find(j => j.id === eetPreviewId) : null;
  const csvPreviewJob = csvPreviewId != null ? (csvJobs ?? []).find(j => j.id === csvPreviewId) : null;
  const modPreviewJob = modPreviewId != null ? (modJobs ?? []).find(j => j.id === modPreviewId) : null;
  const visibleNexusDownloads = nexusDownloads.filter((d) => d.gameId === gameId);

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

            return (
              <UnifiedJobRow
                key={key}
                kind={u.kind}
                job={u.job}
                live={live}
                isRunning={isRunning}
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
                  const p = u.kind === 'eet' ? api.eet.remove(u.job.id)
                    : u.kind === 'csv' ? api.csv.remove(u.job.id)
                    : api.modImport.remove(u.job.id);
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
          onClose={() => setModPreviewId(null)}
          onConfirm={async (lang) => {
            await api.modImport.updateLanguages(modPreviewJob.id, lang, lang);
            refreshAll();
            setModPreviewId(null);
            setTimeout(() => doStart('mod', modPreviewJob.id), 100);
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
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── Unified job row ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

/** Single row in the unified import list, with a colored type badge. */
const UnifiedJobRow = ({ kind, job, live, isRunning, onStart, onPause, onCancel, onDelete }: {
  kind: 'eet' | 'csv' | 'mod';
  job: EetImportJob | CsvImportJob | ModImportJob;
  live?: LiveProgress;
  isRunning: boolean;
  onStart: () => void;
  onPause: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) => {
  const { t } = useTranslation();
  const imported = live?.imported ?? job.imported_records;
  const total = live?.total ?? job.total_records;
  const pct = total > 0 ? Math.round((imported / total) * 100) : 0;
  const canStart = !isRunning && job.status !== 'completed' && job.status !== 'in_progress';
  const isMod = kind === 'mod';
  const modJob = isMod ? (job as ModImportJob) : null;

  return (
    <div className={s.row}>
      <div className={s.rowLeft}>
        <span className={s.typeBadge} style={{ background: kindColor(kind) }}>{kind.toUpperCase()}</span>
        <div>
          <span className={s.fileName}>
            {job.file_name}
            {modJob?.is_localized ? <span className={s.locBadge}>{t('modImport.localized')}</span> : null}
          </span>
          <span className={s.meta}>
            {isMod && modJob?.is_localized
              ? t('common.strings', { count: total.toLocaleString() })
              : `${job.src_lang} \u2192 ${job.tgt_lang} \u00b7 ${total.toLocaleString()} records`}
          </span>
        </div>
      </div>
      <div className={s.rowRight}>
        {job.status === 'completed' ? (
          <span className={s.badgeCompleted}>{t('importStatus.completed')}</span>
        ) : isRunning ? (
          <div className={s.progressWrap}>
            <div className={s.progressTrack}><div className={s.progressFill} style={{ width: `${pct}%` }} /></div>
            <span className={s.progressLabel}>{pct}%</span>
          </div>
        ) : (
          <span
            className={s.badge}
            style={{ background: statusColorBase(job.status) }}
            title={job.status === 'failed' && 'last_error' in job && (job as EetImportJob).last_error ? (job as EetImportJob).last_error! : undefined}
          >
            {statusLabel(job.status, t)}{job.imported_records > 0 && ` (${pct}%)`}
          </span>
        )}
        <div className={s.actions}>
          {canStart && <button onClick={onStart} className={s.actionBtn} title="▶">▶</button>}
          {isRunning && <button onClick={onPause} className={s.actionBtn} title="⏸">⏸</button>}
          {isRunning && <button onClick={onCancel} className={s.actionBtnCancel} title={t('common.cancel')}>⏹</button>}
          {!isRunning && <button onClick={onDelete} className={s.actionBtnDelete} title={t('common.delete')}>🗑</button>}
        </div>
      </div>
    </div>
  );
};

/** Virtual row for a Nexus file that is still downloading before import job creation. */
const NexusDownloadRow = ({ job }: { job: NexusDownloadJob }) => {
  const { t } = useTranslation();
  const pct = Math.max(0, Math.min(100, Math.round(job.progress)));

  return (
    <div className={s.row}>
      <div className={s.rowLeft}>
        <span className={s.typeBadge} style={{ background: kindColor('mod') }}>MOD</span>
        <div>
          <span className={s.fileName}>{job.fileName}</span>
          <span className={s.meta}>{job.gameId.toUpperCase()} · Nexus #{job.modId} · file #{job.fileId}</span>
        </div>
      </div>
      <div className={s.rowRight}>
        {job.status === 'failed' ? (
          <span className={s.badge} style={{ background: statusColorBase('failed') }}>
            {t('importStatus.failed')}
          </span>
        ) : (
          <div className={s.progressWrap}>
            <div className={s.progressTrack}><div className={s.progressFill} style={{ width: `${pct}%` }} /></div>
            <span className={s.progressLabel}>{pct}%</span>
          </div>
        )}
        <div className={s.actions}>
          <span className={s.badge} style={{ background: statusColorBase('in_progress') }}>
            {t('importStatus.downloading')}
          </span>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── EET preview modal ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const EetPreviewModal = ({ job, onClose, onConfirm }: {
  job: EetImportJob; onClose: () => void; onConfirm: (srcLang: string, tgtLang: string) => void;
}) => {
  const { t } = useTranslation();
  const [srcLang, setSrcLang] = useState(job.src_lang);
  const [tgtLang, setTgtLang] = useState(job.tgt_lang);
  const [page, setPage] = useState(1);
  const [sigFilter, setSigFilter] = useState('');
  const [qFilter, setQFilter] = useState('');
  const [qInput, setQInput] = useState('');
  const pageSize = 50;

  useEffect(() => {
    const id = setTimeout(() => { setQFilter(qInput); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [qInput]);

  const { data, isLoading } = useQuery({
    queryKey: ['eet-preview', job.id, page, pageSize, sigFilter, qFilter],
    queryFn: () => api.eet.preview(job.id, { page, pageSize, signature: sigFilter || undefined, q: qFilter || undefined }),
    staleTime: 30_000,
  });
  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.modalHeader}>
          <h2 className={s.modalHeaderTitle}>{job.file_name}</h2>
          <button onClick={onClose} className={s.closeBtn}>✕</button>
        </div>
        <div className={s.langBar}>
          <label className={s.langLabel}>{t('csvImport.sourceLang')}
            <select value={srcLang} onChange={e => setSrcLang(e.target.value)} className={s.select}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label} ({l.code})</option>)}
            </select>
          </label>
          <span className={s.langArrow}>{'\u2192'}</span>
          <label className={s.langLabel}>{t('csvImport.targetLang')}
            <select value={tgtLang} onChange={e => setTgtLang(e.target.value)} className={s.select}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label} ({l.code})</option>)}
            </select>
          </label>
        </div>
        <div className={s.filterBar}>
          <select value={sigFilter} onChange={e => { setSigFilter(e.target.value); setPage(1); }} className={s.selectSig}>
            <option value="">{t('csvImport.allSignatures')}</option>
            {(data?.signatures ?? []).map(sig => <option key={sig} value={sig}>{sig}</option>)}
          </select>
          <input type="text" placeholder={t('csvImport.searchPlaceholder')} value={qInput} onChange={e => setQInput(e.target.value)} className={s.searchInput} />
          <span className={s.filterBarCount}>{data ? t('common.records', { count: data.total.toLocaleString() }) : ''}</span>
        </div>
        <div className={s.tableWrap}>
          {isLoading ? <div className={s.tableEmpty}>{t('common.loading')}</div> : (
            <table className={s.table}>
              <thead><tr>
                <th className={s.th}>{t('csvImport.signature')}</th>
                <th className={s.th}>{t('csvImport.formId')}</th>
                <th className={s.th}>{t('csvImport.edid')}</th>
                <th className={s.th}>{t('csvImport.fieldCol')}</th>
                <th className={s.thSource}>{t('csvImport.sourceCol')}</th>
                <th className={s.thSource}>{t('csvImport.targetCol')}</th>
                <th className={s.th}>{t('csvImport.statusCol')}</th>
              </tr></thead>
              <tbody>
                {(data?.rows ?? []).map((r: EetPreviewRow, i: number) => (
                  <tr key={i}>
                    <td className={s.td}><code className={s.codeSignature}>{r.signature}</code></td>
                    <td className={s.td}><code className={s.codeFormId}>{r.formId}</code></td>
                    <td className={s.tdEdid} title={r.edid}>{r.edid || '\u2014'}</td>
                    <td className={s.td}>{r.field}</td>
                    <td className={s.td}>{r.source}</td>
                    <td className={s.td}>{r.target || <span className={s.emptyValue}>{'\u2014'}</span>}</td>
                    <td className={s.td}>
                      <span className={`${s.statusDot} ${r.status === 0x63 ? s.statusDotConfirmed : r.status === 0xFF ? s.statusDotUntranslated : s.statusDotOther}`} />
                      {r.status === 0x63 ? t('csvImport.confirmed') : r.status === 0xFF ? t('csvImport.untranslated') : String(r.status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {totalPages > 1 && (
          <div className={s.pagination}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className={s.pageBtn}>{t('common.prev')}</button>
            <span className={s.paginationLabel}>{t('common.page', { page, totalPages })}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className={s.pageBtn}>{t('common.next')}</button>
          </div>
        )}
        <div className={s.footer}>
          <button onClick={onClose} className={s.btnCancel}>{t('common.cancel')}</button>
          <button onClick={() => onConfirm(srcLang, tgtLang)} className={s.btnConfirm}>
            {t('csvImport.startImport', { count: job.total_records.toLocaleString() })}
          </button>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── CSV preview modal ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const CsvPreviewModal = ({ job, onClose, onConfirm }: {
  job: CsvImportJob; onClose: () => void; onConfirm: (srcLang: string, tgtLang: string) => void;
}) => {
  const { t } = useTranslation();
  const [srcLang, setSrcLang] = useState(job.src_lang);
  const [tgtLang, setTgtLang] = useState(job.tgt_lang);
  const [page, setPage] = useState(1);
  const [sigFilter, setSigFilter] = useState('');
  const [qFilter, setQFilter] = useState('');
  const [qInput, setQInput] = useState('');
  const pageSize = 50;

  useEffect(() => {
    const id = setTimeout(() => { setQFilter(qInput); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [qInput]);

  const { data, isLoading } = useQuery({
    queryKey: ['csv-preview', job.id, page, pageSize, sigFilter, qFilter],
    queryFn: () => api.csv.preview(job.id, { page, pageSize, signature: sigFilter || undefined, q: qFilter || undefined }),
    staleTime: 30_000,
  });
  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.modalHeader}>
          <h2 className={s.modalHeaderTitle}>{job.file_name}</h2>
          <button onClick={onClose} className={s.closeBtn}>✕</button>
        </div>
        <div className={s.langBar}>
          <label className={s.langLabel}>{t('csvImport.sourceLang')}
            <select value={srcLang} onChange={e => setSrcLang(e.target.value)} className={s.select}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label} ({l.code})</option>)}
            </select>
          </label>
          <span className={s.langArrow}>{'\u2192'}</span>
          <label className={s.langLabel}>{t('csvImport.targetLang')}
            <select value={tgtLang} onChange={e => setTgtLang(e.target.value)} className={s.select}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label} ({l.code})</option>)}
            </select>
          </label>
        </div>
        <div className={s.filterBar}>
          <select value={sigFilter} onChange={e => { setSigFilter(e.target.value); setPage(1); }} className={s.selectSig}>
            <option value="">{t('csvImport.allSignatures')}</option>
            {(data?.signatures ?? []).map(sig => <option key={sig} value={sig}>{sig}</option>)}
          </select>
          <input type="text" placeholder={t('csvImport.searchPlaceholder')} value={qInput} onChange={e => setQInput(e.target.value)} className={s.searchInput} />
          <span className={s.filterBarCount}>{data ? t('common.records', { count: data.total.toLocaleString() }) : ''}</span>
        </div>
        <div className={s.tableWrap}>
          {isLoading ? <div className={s.tableEmpty}>{t('common.loading')}</div> : (
            <table className={s.table}>
              <thead><tr>
                <th className={s.th}>{t('csvImport.signature')}</th>
                <th className={s.th}>{t('csvImport.formId')}</th>
                <th className={s.th}>{t('csvImport.edid')}</th>
                <th className={s.th}>{t('csvImport.fieldCol')}</th>
                <th className={s.thSource}>{t('csvImport.sourceCol')}</th>
                <th className={s.thSource}>{t('csvImport.targetCol')}</th>
                <th className={s.th}>{t('csvImport.statusCol')}</th>
              </tr></thead>
              <tbody>
                {(data?.rows ?? []).map((r: CsvPreviewRow, i: number) => (
                  <tr key={i}>
                    <td className={s.td}><code className={s.codeSignature}>{r.signature}</code></td>
                    <td className={s.td}><code className={s.codeFormId}>{r.formId}</code></td>
                    <td className={s.tdEdid} title={r.edid}>{r.edid || '\u2014'}</td>
                    <td className={s.td}>{r.field}</td>
                    <td className={s.td}>{r.source}</td>
                    <td className={s.td}>{r.target || <span className={s.emptyValue}>{'\u2014'}</span>}</td>
                    <td className={s.td}>
                      <span className={`${s.statusDot} ${r.status === 0x63 ? s.statusDotConfirmed : r.status === 0xFF ? s.statusDotUntranslated : s.statusDotOther}`} />
                      {r.status === 0x63 ? t('csvImport.confirmed') : r.status === 0xFF ? t('csvImport.untranslated') : String(r.status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {totalPages > 1 && (
          <div className={s.pagination}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className={s.pageBtn}>{t('common.prev')}</button>
            <span className={s.paginationLabel}>{t('common.page', { page, totalPages })}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className={s.pageBtn}>{t('common.next')}</button>
          </div>
        )}
        <div className={s.footer}>
          <button onClick={onClose} className={s.btnCancel}>{t('common.cancel')}</button>
          <button onClick={() => onConfirm(srcLang, tgtLang)} className={s.btnConfirm}>
            {t('csvImport.startImport', { count: job.total_records.toLocaleString() })}
          </button>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── Mod preview modal ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const ModPreviewModal = ({ job, onClose, onConfirm }: {
  job: ModImportJob; onClose: () => void; onConfirm: (lang: string) => void;
}) => {
  const { t } = useTranslation();
  const [lang, setLang] = useState(job.src_lang);
  const [page, setPage] = useState(1);
  const [sigFilter, setSigFilter] = useState('');
  const [qFilter, setQFilter] = useState('');
  const [qInput, setQInput] = useState('');
  const pageSize = 50;

  useEffect(() => {
    const id = setTimeout(() => { setQFilter(qInput); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [qInput]);

  const { data, isLoading } = useQuery({
    queryKey: ['mod-import-preview', job.id, page, pageSize, sigFilter, qFilter],
    queryFn: () => api.modImport.preview(job.id, { page, pageSize, signature: sigFilter || undefined, q: qFilter || undefined }),
    staleTime: 30_000,
  });
  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.modalHeaderTop}>
          <div>
            <h2 className={s.modalHeaderTitle}>{job.file_name}</h2>
            {data && (
              <span className={s.modalHeaderMeta}>
                {data.isLocalized ? t('modImport.localizedPlugin') : t('modImport.nonLocalizedPlugin')}
                {data.locales.length > 0 && ` \u00b7 ${t('modImport.locales', { locales: data.locales.join(', ') })}`}
              </span>
            )}
          </div>
          <button onClick={onClose} className={s.closeBtn}>✕</button>
        </div>
        <div className={s.langBar}>
          <label className={s.langLabel}>{t('modImport.languageOfText')}
            <select value={lang} onChange={e => setLang(e.target.value)} className={s.select}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label} ({l.code})</option>)}
            </select>
          </label>
        </div>
        <div className={s.filterBar}>
          <select value={sigFilter} onChange={e => { setSigFilter(e.target.value); setPage(1); }} className={s.selectSig}>
            <option value="">{t('csvImport.allSignatures')}</option>
            {(data?.signatures ?? []).map(sig => <option key={sig} value={sig}>{sig}</option>)}
          </select>
          <input type="text" placeholder={t('csvImport.searchPlaceholder')} value={qInput} onChange={e => setQInput(e.target.value)} className={s.searchInput} />
          <span className={s.filterBarCount}>{data ? t('common.strings', { count: data.total.toLocaleString() }) : ''}</span>
        </div>
        <div className={s.tableWrap}>
          {isLoading ? <div className={s.tableEmpty}>{t('common.loading')}</div> : (
            <table className={s.table}>
              <thead><tr>
                <th className={s.th}>{t('csvImport.signature')}</th>
                <th className={s.th}>{t('csvImport.formId')}</th>
                <th className={s.th}>{t('csvImport.edid')}</th>
                <th className={s.th}>{t('modImport.path')}</th>
                <th className={s.thSourceWide}>{t('csvImport.sourceCol')}</th>
              </tr></thead>
              <tbody>
                {(data?.rows ?? []).map((r: ModPreviewRow, i: number) => (
                  <tr key={i}>
                    <td className={s.td}><code className={s.codeSignature}>{r.signature}</code></td>
                    <td className={s.td}><code className={s.codeFormId}>{r.formId}</code></td>
                    <td className={s.tdEdid} title={r.edid}>{r.edid || '\u2014'}</td>
                    <td className={s.td}>{r.path}</td>
                    <td className={s.td}>{r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {totalPages > 1 && (
          <div className={s.pagination}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className={s.pageBtn}>{t('common.prev')}</button>
            <span className={s.paginationLabel}>{t('common.page', { page, totalPages })}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className={s.pageBtn}>{t('common.next')}</button>
          </div>
        )}
        <div className={s.footer}>
          <button onClick={onClose} className={s.btnCancel}>{t('common.cancel')}</button>
          <button onClick={() => onConfirm(lang)} className={s.btnConfirm}>
            {t('modImport.importAs', { lang, count: job.total_records.toLocaleString() })}
          </button>
        </div>
      </div>
    </div>
  );
};
