import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type CsvImportJob,
  type CsvProgressEvent,
  type CsvPreviewRow,
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

export const CsvImportsPage = () => {
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
      for (const f of Array.from(files)) {
        lastJob = await api.csv.upload(f);
      }
      refresh();
      if (files.length === 1 && lastJob) {
        setPreviewJobId(lastJob.id);
      }
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

  const handlePause = async (jobId: number) => { await api.csv.pause(jobId); };
  const handleCancel = async (jobId: number) => { await api.csv.cancel(jobId); };
  const handleDelete = async (jobId: number) => { await api.csv.remove(jobId); refresh(); };

  if (isLoading) return <div className={s.center}>Loading...</div>;
  if (error) return <div className={`${s.center} ${s.error}`}>Error: {String(error)}</div>;

  const pendingCount = (jobs ?? []).filter(j =>
    j.status === 'pending' || j.status === 'paused' || j.status === 'failed',
  ).length;

  const previewJob = previewJobId != null ? (jobs ?? []).find(j => j.id === previewJobId) : null;

  return (
    <div className={s.page}>
      <h1 className={s.title}>CSV Imports</h1>

      <div className={s.uploadBar}>
        <input ref={fileRef} type="file" accept=".csv" multiple className={s.fileInput} />
        <button onClick={handleUpload} disabled={uploading} className={s.btn}>
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
        {pendingCount > 0 && (
          <button onClick={startMultiple} className={s.btnImportAll}>
            Import all ({pendingCount})
          </button>
        )}
      </div>

      {!jobs?.length ? (
        <p className={s.empty}>
          No CSV files uploaded yet. Upload <code>.csv</code> files to get started.
        </p>
      ) : (
        <div className={s.list}>
          {jobs.map(job => (
            <JobRow
              key={job.id}
              job={job}
              live={liveProgress[job.id]}
              isRunning={job.running || !!liveProgress[job.id]}
              onStart={() => setPreviewJobId(job.id)}
              onPause={() => handlePause(job.id)}
              onCancel={() => handleCancel(job.id)}
              onDelete={() => handleDelete(job.id)}
            />
          ))}
        </div>
      )}

      {previewJob && (
        <PreviewModal
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
    </div>
  );
}

// ── Job row ───────────────────────────────────────────────────────────────────

const JobRow = ({
  job, live, isRunning, onStart, onPause, onCancel, onDelete,
}: {
  job: CsvImportJob; live?: LiveProgress; isRunning: boolean;
  onStart: () => void; onPause: () => void; onCancel: () => void; onDelete: () => void;
}) => {
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
        <span className={s.fileName}>{job.file_name}</span>
        <span className={s.meta}>
          {job.src_lang} → {job.tgt_lang} · {total.toLocaleString()} records
        </span>
      </div>
      <div className={s.rowRight}>
        {job.status === 'completed' ? (
          <span className={s.badgeCompleted}>Completed</span>
        ) : isRunning ? (
          <div className={s.progressWrap}>
            <div className={s.progressTrack}>
              <div className={s.progressFill} style={{ width: `${pct}%` }} />
            </div>
            <span className={s.progressLabel}>{pct}%</span>
          </div>
        ) : (
          <span className={s.badge} style={{ background: statusColor(job.status) }}>
            {statusLabel(job.status)}
            {job.imported_records > 0 && ` (${pct}%)`}
          </span>
        )}
        <div className={s.actions}>
          {canStart && <button onClick={onStart} className={s.actionBtn} title="Start import">▶</button>}
          {canPause && <button onClick={onPause} className={s.actionBtn} title="Pause">⏸</button>}
          {canCancel && <button onClick={onCancel} className={s.actionBtnCancel} title="Cancel">⏹</button>}
          {canDelete && <button onClick={onDelete} className={s.actionBtnDelete} title="Delete">🗑</button>}
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
  job: CsvImportJob;
  onClose: () => void;
  onConfirm: (srcLang: string, tgtLang: string) => void;
}) => {
  const [srcLang, setSrcLang] = useState(job.src_lang);
  const [tgtLang, setTgtLang] = useState(job.tgt_lang);
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
          <label className={s.langLabel}>
            Source language
            <select value={srcLang} onChange={e => setSrcLang(e.target.value)} className={s.select}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label} ({l.code})</option>)}
            </select>
          </label>
          <span className={s.langArrow}>→</span>
          <label className={s.langLabel}>
            Target language
            <select value={tgtLang} onChange={e => setTgtLang(e.target.value)} className={s.select}>
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
            <option value="">All signatures</option>
            {(data?.signatures ?? []).map(sig => (
              <option key={sig} value={sig}>{sig}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Search FormID / EDID / text..."
            value={qInput}
            onChange={e => setQInput(e.target.value)}
            className={s.searchInput}
          />
          <span className={s.filterBarCount}>
            {data ? `${data.total.toLocaleString()} records` : ''}
          </span>
        </div>

        <div className={s.tableWrap}>
          {isLoading ? (
            <div className={s.tableEmpty}>Loading...</div>
          ) : (
            <table className={s.table}>
              <thead>
                <tr>
                  <th className={s.th}>Signature</th>
                  <th className={s.th}>FormID</th>
                  <th className={s.th}>EDID</th>
                  <th className={s.th}>Field</th>
                  <th className={s.thSource}>Source</th>
                  <th className={s.thSource}>Target</th>
                  <th className={s.th}>Status</th>
                </tr>
              </thead>
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
                      {r.status === 0x63 ? 'confirmed' : r.status === 0xFF ? 'untranslated' : String(r.status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div className={s.pagination}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className={s.pageBtn}>← Prev</button>
            <span className={s.paginationLabel}>Page {page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className={s.pageBtn}>Next →</button>
          </div>
        )}

        <div className={s.footer}>
          <button onClick={onClose} className={s.btnCancel}>Cancel</button>
          <button
            onClick={() => onConfirm(srcLang, tgtLang)}
            className={s.btnConfirm}
          >
            Start import ({job.total_records.toLocaleString()} records)
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
    case 'in_progress': return '#1565c0';
    case 'paused': return '#e65100';
    case 'failed': return '#b71c1c';
    case 'completed': return '#1b6b2d';
    default: return '#555';
  }
}

const statusLabel = (status: string): string => {
  switch (status) {
    case 'pending': return 'Pending';
    case 'in_progress': return 'In progress';
    case 'paused': return 'Paused';
    case 'failed': return 'Failed';
    case 'completed': return 'Completed';
    default: return status;
  }
}


