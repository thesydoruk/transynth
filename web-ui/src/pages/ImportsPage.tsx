/**
 * ImportsPage — unified import hub.
 *
 * Replaces three separate pages (EetImportsPage, CsvImportsPage, ModImportsPage)
 * with a single tabbed page routed at /imports.
 * Each tab preserves the full functionality of its original page.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
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
} from '../api';
import s from './ImportPage.module.scss';

// ── Shared types & constants ───────────────────────────────────────────────────

type LiveProgress = { imported: number; total: number };
type ImportTab = 'eet' | 'csv' | 'mod';

/** Language options shared by all three import sections. */
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

const statusLabel = (status: string, t: (key: string) => string): string =>
  t(`importStatus.${status}`) || status;

// ── Main page ─────────────────────────────────────────────────────────────────

/** Unified imports page with EET / CSV / Mod tabs. */
export const ImportsPage = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ImportTab>('eet');

  const TABS: { id: ImportTab; label: string }[] = [
    { id: 'eet', label: t('imports.tabEet') },
    { id: 'csv', label: t('imports.tabCsv') },
    { id: 'mod', label: t('imports.tabMod') },
  ];

  return (
    <div className={s.page}>
      <h1 className={s.title}>{t('imports.title')}</h1>

      {/* Tab switcher */}
      <div className={s.tabs}>
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={tab === id ? s.tabActive : s.tab}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Active section */}
      {tab === 'eet' && <EetSection />}
      {tab === 'csv' && <CsvSection />}
      {tab === 'mod' && <ModSection />}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── EET section ───────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const EetSection = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: jobs, isLoading, error } = useQuery({
    queryKey: ['eet-imports'],
    queryFn: api.eet.list,
    refetchInterval: 3000,
  });

  const [uploading, setUploading] = useState(false);
  const [liveProgress, setLiveProgress] = useState<Record<number, LiveProgress>>({});
  const abortRefs = useRef<Record<number, AbortController>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const [previewJobId, setPreviewJobId] = useState<number | null>(null);

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['eet-imports'] }), [qc]);

  const handleUpload = async () => {
    const files = fileRef.current?.files;
    if (!files?.length) return;
    setUploading(true);
    try {
      let lastJob: EetImportJob | null = null;
      for (const f of Array.from(files)) lastJob = await api.eet.upload(f);
      refresh();
      if (files.length === 1 && lastJob) setPreviewJobId(lastJob.id);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const doStartImport = (jobId: number) => {
    const { promise, abort } = api.eet.startImport(jobId, (e: EetProgressEvent) => {
      setLiveProgress(prev => ({ ...prev, [jobId]: { imported: e.imported, total: e.total } }));
    });
    abortRefs.current[jobId] = abort;
    const cleanup = () => {
      setLiveProgress(prev => { const c = { ...prev }; delete c[jobId]; return c; });
      delete abortRefs.current[jobId];
      refresh();
    };
    promise.then(cleanup).catch(cleanup);
    refresh();
  };

  const startMultiple = () => {
    (jobs ?? [])
      .filter(j => j.status === 'pending' || j.status === 'paused' || j.status === 'failed')
      .forEach(j => doStartImport(j.id));
  };

  if (isLoading) return <div className={s.sectionLoading}>{t('common.loading')}</div>;
  if (error) return <div className={s.error}>{t('common.error', { message: String(error) })}</div>;

  const pendingCount = (jobs ?? []).filter(j => ['pending', 'paused', 'failed'].includes(j.status)).length;
  const previewJob = previewJobId != null ? (jobs ?? []).find(j => j.id === previewJobId) : null;

  return (
    <>
      <div className={s.uploadBar}>
        <input ref={fileRef} type="file" accept=".eet" multiple className={s.fileInput} />
        <button onClick={handleUpload} disabled={uploading} className={s.btn}>
          {uploading ? t('common.uploading') : t('common.upload')}
        </button>
        {pendingCount > 0 && (
          <button onClick={startMultiple} className={s.btnImportAll}>
            {t('eetImport.importAll', { count: pendingCount })}
          </button>
        )}
      </div>

      {!jobs?.length ? (
        <p className={s.empty}>{t('eetImport.noFiles')}</p>
      ) : (
        <div className={s.list}>
          {jobs.map(job => (
            <EetJobRow
              key={job.id}
              job={job}
              live={liveProgress[job.id]}
              isRunning={job.running || !!liveProgress[job.id]}
              onStart={() => setPreviewJobId(job.id)}
              onPause={() => api.eet.pause(job.id)}
              onCancel={() => api.eet.cancel(job.id)}
              onDelete={() => api.eet.remove(job.id).then(refresh)}
            />
          ))}
        </div>
      )}

      {previewJob && (
        <EetPreviewModal
          job={previewJob}
          onClose={() => setPreviewJobId(null)}
          onConfirm={async (srcLang, tgtLang) => {
            await api.eet.updateLanguages(previewJob.id, srcLang, tgtLang);
            refresh();
            setPreviewJobId(null);
            setTimeout(() => doStartImport(previewJob.id), 100);
          }}
        />
      )}
    </>
  );
};

const EetJobRow = ({ job, live, isRunning, onStart, onPause, onCancel, onDelete }: {
  job: EetImportJob; live?: LiveProgress; isRunning: boolean;
  onStart: () => void; onPause: () => void; onCancel: () => void; onDelete: () => void;
}) => {
  const { t } = useTranslation();
  const imported = live?.imported ?? job.imported_records;
  const total = live?.total ?? job.total_records;
  const pct = total > 0 ? Math.round((imported / total) * 100) : 0;
  const canStart = !isRunning && job.status !== 'completed' && job.status !== 'in_progress';

  return (
    <div className={s.row}>
      <div className={s.rowLeft}>
        <span className={s.fileName}>{job.file_name}</span>
        <span className={s.meta}>{job.src_lang} → {job.tgt_lang} · {total.toLocaleString()} records</span>
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
            title={job.status === 'failed' && job.last_error ? job.last_error : undefined}
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
          <span className={s.langArrow}>→</span>
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
                    <td className={s.tdEdid} title={r.edid}>{r.edid || '—'}</td>
                    <td className={s.td}>{r.field}</td>
                    <td className={s.td}>{r.source}</td>
                    <td className={s.td}>{r.target || <span className={s.emptyValue}>—</span>}</td>
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
// ── CSV section ───────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const CsvSection = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: jobs, isLoading, error } = useQuery({
    queryKey: ['csv-imports'],
    queryFn: api.csv.list,
    refetchInterval: 3000,
  });

  const [uploading, setUploading] = useState(false);
  const [liveProgress, setLiveProgress] = useState<Record<number, LiveProgress>>({});
  const abortRefs = useRef<Record<number, AbortController>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const [previewJobId, setPreviewJobId] = useState<number | null>(null);

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['csv-imports'] }), [qc]);

  const handleUpload = async () => {
    const files = fileRef.current?.files;
    if (!files?.length) return;
    setUploading(true);
    try {
      let lastJob: CsvImportJob | null = null;
      for (const f of Array.from(files)) lastJob = await api.csv.upload(f);
      refresh();
      if (files.length === 1 && lastJob) setPreviewJobId(lastJob.id);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const doStartImport = (jobId: number) => {
    const { promise, abort } = api.csv.startImport(jobId, (e: CsvProgressEvent) => {
      setLiveProgress(prev => ({ ...prev, [jobId]: { imported: e.imported, total: e.total } }));
    });
    abortRefs.current[jobId] = abort;
    const cleanup = () => {
      setLiveProgress(prev => { const c = { ...prev }; delete c[jobId]; return c; });
      delete abortRefs.current[jobId];
      refresh();
    };
    promise.then(cleanup).catch(cleanup);
    refresh();
  };

  const startMultiple = () => {
    (jobs ?? [])
      .filter(j => j.status === 'pending' || j.status === 'paused' || j.status === 'failed')
      .forEach(j => doStartImport(j.id));
  };

  if (isLoading) return <div className={s.sectionLoading}>{t('common.loading')}</div>;
  if (error) return <div className={s.error}>{t('common.error', { message: String(error) })}</div>;

  const pendingCount = (jobs ?? []).filter(j => ['pending', 'paused', 'failed'].includes(j.status)).length;
  const previewJob = previewJobId != null ? (jobs ?? []).find(j => j.id === previewJobId) : null;

  return (
    <>
      <div className={s.uploadBar}>
        <input ref={fileRef} type="file" accept=".csv" multiple className={s.fileInput} />
        <button onClick={handleUpload} disabled={uploading} className={s.btn}>
          {uploading ? t('common.uploading') : t('common.upload')}
        </button>
        {pendingCount > 0 && (
          <button onClick={startMultiple} className={s.btnImportAll}>
            {t('csvImport.importAll', { count: pendingCount })}
          </button>
        )}
      </div>

      {!jobs?.length ? (
        <p className={s.empty}>{t('csvImport.noFiles')}</p>
      ) : (
        <div className={s.list}>
          {jobs.map(job => (
            <CsvJobRow
              key={job.id}
              job={job}
              live={liveProgress[job.id]}
              isRunning={job.running || !!liveProgress[job.id]}
              onStart={() => setPreviewJobId(job.id)}
              onPause={() => api.csv.pause(job.id)}
              onCancel={() => api.csv.cancel(job.id)}
              onDelete={() => api.csv.remove(job.id).then(refresh)}
            />
          ))}
        </div>
      )}

      {previewJob && (
        <CsvPreviewModal
          job={previewJob}
          onClose={() => setPreviewJobId(null)}
          onConfirm={async (srcLang, tgtLang) => {
            await api.csv.updateLanguages(previewJob.id, srcLang, tgtLang);
            refresh();
            setPreviewJobId(null);
            setTimeout(() => doStartImport(previewJob.id), 100);
          }}
        />
      )}
    </>
  );
};

const CsvJobRow = ({ job, live, isRunning, onStart, onPause, onCancel, onDelete }: {
  job: CsvImportJob; live?: LiveProgress; isRunning: boolean;
  onStart: () => void; onPause: () => void; onCancel: () => void; onDelete: () => void;
}) => {
  const { t } = useTranslation();
  const imported = live?.imported ?? job.imported_records;
  const total = live?.total ?? job.total_records;
  const pct = total > 0 ? Math.round((imported / total) * 100) : 0;
  const canStart = !isRunning && job.status !== 'completed' && job.status !== 'in_progress';

  return (
    <div className={s.row}>
      <div className={s.rowLeft}>
        <span className={s.fileName}>{job.file_name}</span>
        <span className={s.meta}>{job.src_lang} → {job.tgt_lang} · {total.toLocaleString()} records</span>
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
          <span className={s.badge} style={{ background: statusColorBase(job.status) }}>
            {statusLabel(job.status, t)}{job.imported_records > 0 && ` (${pct}%)`}
          </span>
        )}
        <div className={s.actions}>
          {canStart && <button onClick={onStart} className={s.actionBtn} title={t('csvImport.startImportBtn')}>▶</button>}
          {isRunning && <button onClick={onPause} className={s.actionBtn} title="⏸">⏸</button>}
          {isRunning && <button onClick={onCancel} className={s.actionBtnCancel} title={t('common.cancel')}>⏹</button>}
          {!isRunning && <button onClick={onDelete} className={s.actionBtnDelete} title={t('common.delete')}>🗑</button>}
        </div>
      </div>
    </div>
  );
};

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
          <span className={s.langArrow}>→</span>
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
                    <td className={s.tdEdid} title={r.edid}>{r.edid || '—'}</td>
                    <td className={s.td}>{r.field}</td>
                    <td className={s.td}>{r.source}</td>
                    <td className={s.td}>{r.target || <span className={s.emptyValue}>—</span>}</td>
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
// ── Mod section ───────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const ACCEPTED_MOD = '.esp,.esm,.esl,.zip,.7z,.rar';

const ModSection = () => {
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

  const doStartImport = (jobId: number) => {
    const { promise, abort } = api.modImport.startImport(jobId, (e: ModProgressEvent) => {
      setLiveProgress(prev => ({ ...prev, [jobId]: { imported: e.imported, total: e.total } }));
    });
    abortRefs.current[jobId] = abort;
    const cleanup = () => {
      setLiveProgress(prev => { const c = { ...prev }; delete c[jobId]; return c; });
      delete abortRefs.current[jobId];
      refresh();
    };
    promise.then(cleanup).catch(cleanup);
    refresh();
  };

  const handleUpload = async () => {
    const files = fileRef.current?.files;
    if (!files?.length) return;
    setUploading(true);
    try {
      let lastJob: ModImportJob | null = null;
      for (const f of Array.from(files)) lastJob = await api.modImport.upload(f);
      refresh();
      if (files.length === 1 && lastJob) {
        if (lastJob.is_localized) {
          doStartImport(lastJob.id);
        } else {
          setPreviewJobId(lastJob.id);
        }
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const startMultiple = () => {
    (jobs ?? [])
      .filter(j => j.status === 'pending' || j.status === 'paused' || j.status === 'failed')
      .forEach(j => doStartImport(j.id));
  };

  if (isLoading) return <div className={s.sectionLoading}>{t('common.loading')}</div>;
  if (error) return <div className={s.error}>{t('common.error', { message: String(error) })}</div>;

  const pendingCount = (jobs ?? []).filter(j => ['pending', 'paused', 'failed'].includes(j.status)).length;
  const previewJob = previewJobId != null ? (jobs ?? []).find(j => j.id === previewJobId) : null;

  return (
    <>
      <div className={s.uploadBar}>
        <input ref={fileRef} type="file" accept={ACCEPTED_MOD} multiple className={s.fileInput} />
        <button onClick={handleUpload} disabled={uploading} className={s.btn}>
          {uploading ? t('common.uploading') : t('common.upload')}
        </button>
        {pendingCount > 0 && (
          <button onClick={startMultiple} className={s.btnImportAll}>
            {t('modImport.importAll', { count: pendingCount })}
          </button>
        )}
      </div>

      <p className={s.subtitle}>{t('modImport.accepts')}</p>

      {!jobs?.length ? (
        <p className={s.empty}>{t('modImport.noFiles')}</p>
      ) : (
        <div className={s.list}>
          {jobs.map(job => (
            <ModJobRow
              key={job.id}
              job={job}
              live={liveProgress[job.id]}
              isRunning={job.running || !!liveProgress[job.id]}
              onStart={() => job.is_localized ? doStartImport(job.id) : setPreviewJobId(job.id)}
              onPause={() => api.modImport.pause(job.id)}
              onCancel={() => api.modImport.cancel(job.id)}
              onDelete={() => api.modImport.remove(job.id).then(refresh)}
            />
          ))}
        </div>
      )}

      {previewJob && !previewJob.is_localized && (
        <ModPreviewModal
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
    </>
  );
};

const ModJobRow = ({ job, live, isRunning, onStart, onPause, onCancel, onDelete }: {
  job: ModImportJob; live?: LiveProgress; isRunning: boolean;
  onStart: () => void; onPause: () => void; onCancel: () => void; onDelete: () => void;
}) => {
  const { t } = useTranslation();
  const imported = live?.imported ?? job.imported_records;
  const total = live?.total ?? job.total_records;
  const pct = total > 0 ? Math.round((imported / total) * 100) : 0;
  const canStart = !isRunning && job.status !== 'completed' && job.status !== 'in_progress';

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
            <div className={s.progressTrack}><div className={s.progressFill} style={{ width: `${pct}%` }} /></div>
            <span className={s.progressLabel}>{pct}%</span>
          </div>
        ) : (
          <span className={s.badge} style={{ background: statusColorBase(job.status) }}>
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
                {data.locales.length > 0 && ` · ${t('modImport.locales', { locales: data.locales.join(', ') })}`}
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
          <button onClick={() => onConfirm(lang)} className={s.btnConfirm}>
            {t('modImport.importAs', { lang, count: job.total_records.toLocaleString() })}
          </button>
        </div>
      </div>
    </div>
  );
};
