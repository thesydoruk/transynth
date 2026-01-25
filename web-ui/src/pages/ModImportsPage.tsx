import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  api,
  type ModImportJob,
  type ModProgressEvent,
  type ModPreviewRow,
} from '../api';
import s from './ImportPage.module.scss';

type LiveProgress = { imported: number; total: number };

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

const ACCEPTED = '.esp,.esm,.esl,.zip,.7z,.rar';

export const ModImportsPage = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: jobs, isLoading, error } = useQuery({
    queryKey: ['mod-imports'],
    queryFn: api.modImport.list,
    refetchInterval: 3000,
  });

  const [uploading, setUploading] = useState(false);
  const [liveProgress, setLiveProgress] = useState<Record<number, LiveProgress>>({});
  const abortRefs = useRef<Record<number, AbortController>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const [previewJobId, setPreviewJobId] = useState<number | null>(null);

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['mod-imports'] }), [qc]);

  const handleUpload = async () => {
    const files = fileRef.current?.files;
    if (!files?.length) return;
    setUploading(true);
    try {
      let lastJob: ModImportJob | null = null;
      for (const f of Array.from(files)) {
        lastJob = await api.modImport.upload(f);
      }
      refresh();
      if (files.length === 1 && lastJob) {
        if (lastJob.is_localized) {
          // Localized: import all locales immediately, no modal
          doStartImport(lastJob.id);
        } else {
          // Non-localized: ask which language the text is in
          setPreviewJobId(lastJob.id);
        }
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const doStartImport = (jobId: number) => {
    const { promise, abort } = api.modImport.startImport(jobId, (e: ModProgressEvent) => {
      setLiveProgress(prev => ({ ...prev, [jobId]: { imported: e.imported, total: e.total } }));
    });
    abortRefs.current[jobId] = abort;

    promise
      .then(() => {
        setLiveProgress(prev => { const c = { ...prev }; delete c[jobId]; return c; });
        delete abortRefs.current[jobId];
        refresh();
      })
      .catch(() => {
        setLiveProgress(prev => { const c = { ...prev }; delete c[jobId]; return c; });
        delete abortRefs.current[jobId];
        refresh();
      });
    refresh();
  };

  const startMultiple = () => {
    const pending = (jobs ?? []).filter(j => j.status === 'pending' || j.status === 'paused' || j.status === 'failed');
    for (const j of pending) doStartImport(j.id);
  };

  const handlePause = async (jobId: number) => { await api.modImport.pause(jobId); };
  const handleCancel = async (jobId: number) => { await api.modImport.cancel(jobId); };
  const handleDelete = async (jobId: number) => { await api.modImport.remove(jobId); refresh(); };

  if (isLoading) return <div className={s.center}>{t('common.loading')}</div>;
  if (error) return <div className={`${s.center} ${s.error}`}>{t('common.error', { message: String(error) })}</div>;

  const pendingCount = (jobs ?? []).filter(j =>
    j.status === 'pending' || j.status === 'paused' || j.status === 'failed',
  ).length;

  const previewJob = previewJobId != null ? (jobs ?? []).find(j => j.id === previewJobId) : null;

  return (
    <div className={s.page}>
      <h1 className={s.title}>{t('modImport.title')}</h1>

      <div className={s.uploadBar}>
        <input ref={fileRef} type="file" accept={ACCEPTED} multiple className={s.fileInput} />
        <button onClick={handleUpload} disabled={uploading} className={s.btn}>
          {uploading ? t('common.uploading') : t('common.upload')}
        </button>
        {pendingCount > 0 && (
          <button onClick={startMultiple} className={s.btnImportAll}>
            {t('modImport.importAll', { count: pendingCount })}
          </button>
        )}
      </div>

      <p className={s.subtitle}>
        {t('modImport.accepts')}
      </p>

      {!jobs?.length ? (
        <p className={s.empty}>
          {t('modImport.noFiles')}
        </p>
      ) : (
        <div className={s.list}>
          {jobs.map(job => (
            <JobRow
              key={job.id}
              job={job}
              live={liveProgress[job.id]}
              isRunning={job.running || !!liveProgress[job.id]}
              onStart={() => job.is_localized ? doStartImport(job.id) : setPreviewJobId(job.id)}
              onPause={() => handlePause(job.id)}
              onCancel={() => handleCancel(job.id)}
              onDelete={() => handleDelete(job.id)}
            />
          ))}
        </div>
      )}

      {previewJob && !previewJob.is_localized && (
        <PreviewModal
          job={previewJob}
          onClose={() => setPreviewJobId(null)}
          onConfirm={async (lang) => {
            await api.modImport.updateLanguages(previewJob.id, lang, lang);
            refresh();
            setPreviewJobId(null);
            setTimeout(() => doStartImport(previewJob.id), 100);
          }}
        />
      )}
    </div>
  );
}

// ── Job row ───────────────────────────────────────────────────────────────────

const JobRow = ({
  job, live, isRunning, onStart, onPause, onCancel, onDelete,
}: {
  job: ModImportJob; live?: LiveProgress; isRunning: boolean;
  onStart: () => void; onPause: () => void; onCancel: () => void; onDelete: () => void;
}) => {
  const { t } = useTranslation();
  const imported = live?.imported ?? job.imported_records;
  const total = live?.total ?? job.total_records;
  const pct = total > 0 ? Math.round((imported / total) * 100) : 0;

  const canStart = !isRunning && job.status !== 'completed' && job.status !== 'in_progress';
  const canPause = isRunning;
  const canCancel = isRunning;
  const canDelete = !isRunning;

  return (
    <div className={s.row}>
      <div className={s.rowLeft}>
        <span className={s.fileName}>
          {job.file_name}
          {job.is_localized ? <span className={s.locBadge}>{t('modImport.localized')}</span> : null}
        </span>
        <span className={s.meta}>
          {job.is_localized ? '' : `${job.src_lang} · `}{t('common.strings', { count: total.toLocaleString() })}
        </span>
      </div>
      <div className={s.rowRight}>
        {job.status === 'completed' ? (
          <span className={s.badgeCompleted}>{t('importStatus.completed')}</span>
        ) : isRunning ? (
          <div className={s.progressWrap}>
            <div className={s.progressTrack}>
              <div className={s.progressFill} style={{ width: `${pct}%` }} />
            </div>
            <span className={s.progressLabel}>{pct}%</span>
          </div>
        ) : (
          <span className={s.badge} style={{ background: statusColor(job.status) }}>
            {statusLabel(job.status, t)}
            {job.imported_records > 0 && ` (${pct}%)`}
          </span>
        )}
        <div className={s.actions}>
          {canStart && <button onClick={onStart} className={s.actionBtn} title="▶">▶</button>}
          {canPause && <button onClick={onPause} className={s.actionBtn} title="⏸">⏸</button>}
          {canCancel && <button onClick={onCancel} className={s.actionBtnCancel} title={t('common.cancel')}>⏹</button>}
          {canDelete && <button onClick={onDelete} className={s.actionBtnDelete} title={t('common.delete')}>🗑</button>}
        </div>
      </div>
    </div>
  );
}

// ── Preview Modal ─────────────────────────────────────────────────────────────

const PreviewModal = ({
  job,
  onClose,
  onConfirm,
}: {
  job: ModImportJob;
  onClose: () => void;
  onConfirm: (lang: string) => void;
}) => {
  const { t } = useTranslation();
  const [lang, setLang] = useState(job.src_lang);
  const [page, setPage] = useState(1);
  const [sigFilter, setSigFilter] = useState('');
  const [qFilter, setQFilter] = useState('');
  const [qInput, setQInput] = useState('');
  const pageSize = 50;

  useEffect(() => {
    const t = setTimeout(() => { setQFilter(qInput); setPage(1); }, 300);
    return () => clearTimeout(t);
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
                {data.locales.length > 0 && ` · ${t('modImport.locales', { locales: data.locales.join(', ') })}`}
              </span>
            )}
          </div>
          <button onClick={onClose} className={s.closeBtn}>✕</button>
        </div>

        <div className={s.langBar}>
          <label className={s.langLabel}>
            {t('modImport.languageOfText')}
            <select value={lang} onChange={e => setLang(e.target.value)} className={s.select}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label} ({l.code})</option>)}
            </select>
          </label>
        </div>

        <div className={s.filterBar}>
          <select
            value={sigFilter}
            onChange={e => { setSigFilter(e.target.value); setPage(1); }}
            className={s.selectSig}
          >
            <option value="">{t('csvImport.allSignatures')}</option>
            {(data?.signatures ?? []).map(sig => (
              <option key={sig} value={sig}>{sig}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder={t('csvImport.searchPlaceholder')}
            value={qInput}
            onChange={e => setQInput(e.target.value)}
            className={s.searchInput}
          />
          <span className={s.filterBarCount}>
            {data ? t('common.strings', { count: data.total.toLocaleString() }) : ''}
          </span>
        </div>

        <div className={s.tableWrap}>
          {isLoading ? (
            <div className={s.tableEmpty}>{t('common.loading')}</div>
          ) : (
            <table className={s.table}>
              <thead>
                <tr>
                  <th className={s.th}>{t('csvImport.signature')}</th>
                  <th className={s.th}>{t('csvImport.formId')}</th>
                  <th className={s.th}>{t('csvImport.edid')}</th>
                  <th className={s.th}>{t('modImport.path')}</th>
                  <th className={s.thSourceWide}>{t('csvImport.sourceCol')}</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows ?? []).map((r: ModPreviewRow, i: number) => (
                  <tr key={i}>
                    <td className={s.td}><code className={s.codeSignature}>{r.signature}</code></td>
                    <td className={s.td}><code className={s.codeFormId}>{r.formId}</code></td>
                    <td className={s.tdEdid} title={r.edid}>{r.edid || '—'}</td>
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
          <button
            onClick={() => onConfirm(lang)}
            className={s.btnConfirm}
          >
            {t('modImport.importAs', { lang, count: job.total_records.toLocaleString() })}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const statusColor = (status: string): string => {
  switch (status) {
    case 'pending': return '#555';
    case 'extracting': return '#6a1b9a';
    case 'in_progress': return '#1565c0';
    case 'paused': return '#e65100';
    case 'failed': return '#b71c1c';
    case 'completed': return '#1b6b2d';
    default: return '#555';
  }
}

const statusLabel = (status: string, t: (key: string) => string): string => {
  return t(`importStatus.${status}`) || status;
}


