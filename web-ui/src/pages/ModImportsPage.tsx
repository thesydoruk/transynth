import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type ModImportJob,
  type ModProgressEvent,
  type ModPreviewRow,
} from '../api';

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

  if (isLoading) return <div style={st.center}>Loading...</div>;
  if (error) return <div style={{ ...st.center, color: '#f44' }}>Error: {String(error)}</div>;

  const pendingCount = (jobs ?? []).filter(j =>
    j.status === 'pending' || j.status === 'paused' || j.status === 'failed',
  ).length;

  const previewJob = previewJobId != null ? (jobs ?? []).find(j => j.id === previewJobId) : null;

  return (
    <div style={st.page}>
      <h1 style={st.title}>Mod Import</h1>

      <div style={st.uploadBar}>
        <input ref={fileRef} type="file" accept={ACCEPTED} multiple style={st.fileInput} />
        <button onClick={handleUpload} disabled={uploading} style={st.btn}>
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
        {pendingCount > 0 && (
          <button onClick={startMultiple} style={{ ...st.btn, marginLeft: 8, background: '#1b6b2d' }}>
            Import all ({pendingCount})
          </button>
        )}
      </div>

      <p style={{ color: '#666', fontSize: 12, margin: '-16px 0 20px 4px' }}>
        Accepts <code>.esp</code> / <code>.esm</code> / <code>.esl</code> plugins or <code>.zip</code> / <code>.7z</code> / <code>.rar</code> archives containing plugin + BA2 files.
      </p>

      {!jobs?.length ? (
        <p style={{ color: '#888', marginTop: 32 }}>
          No mod files uploaded yet. Upload plugin files or archives to get started.
        </p>
      ) : (
        <div style={st.list}>
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
  const imported = live?.imported ?? job.imported_records;
  const total = live?.total ?? job.total_records;
  const pct = total > 0 ? Math.round((imported / total) * 100) : 0;

  const canStart = !isRunning && job.status !== 'completed' && job.status !== 'in_progress';
  const canPause = isRunning;
  const canCancel = isRunning;
  const canDelete = !isRunning;

  return (
    <div style={st.row}>
      <div style={st.rowLeft}>
        <span style={st.fileName}>
          {job.file_name}
          {job.is_localized ? <span style={st.locBadge}>localized</span> : null}
        </span>
        <span style={st.meta}>
          {job.is_localized ? '' : `${job.src_lang} · `}{total.toLocaleString()} strings
        </span>
      </div>
      <div style={st.rowRight}>
        {job.status === 'completed' ? (
          <span style={{ ...st.badge, background: '#1b6b2d' }}>Completed</span>
        ) : isRunning ? (
          <div style={st.progressWrap}>
            <div style={st.progressTrack}>
              <div style={{ ...st.progressFill, width: `${pct}%` }} />
            </div>
            <span style={st.progressLabel}>{pct}%</span>
          </div>
        ) : (
          <span style={{ ...st.badge, background: statusColor(job.status) }}>
            {statusLabel(job.status)}
            {job.imported_records > 0 && ` (${pct}%)`}
          </span>
        )}
        <div style={st.actions}>
          {canStart && <button onClick={onStart} style={st.actionBtn} title="Start import">▶</button>}
          {canPause && <button onClick={onPause} style={st.actionBtn} title="Pause">⏸</button>}
          {canCancel && <button onClick={onCancel} style={{ ...st.actionBtn, color: '#f44' }} title="Cancel">⏹</button>}
          {canDelete && <button onClick={onDelete} style={{ ...st.actionBtn, color: '#999' }} title="Delete">🗑</button>}
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
    <div style={mo.overlay} onClick={onClose}>
      <div style={mo.modal} onClick={e => e.stopPropagation()}>
        <div style={mo.header}>
          <div>
            <h2 style={{ margin: 0, color: '#eee' }}>{job.file_name}</h2>
            {data && (
              <span style={{ color: '#888', fontSize: 12 }}>
                {data.isLocalized ? 'Localized plugin' : 'Non-localized plugin'}
                {data.locales.length > 0 && ` · Locales: ${data.locales.join(', ')}`}
              </span>
            )}
          </div>
          <button onClick={onClose} style={mo.closeBtn}>✕</button>
        </div>

        <div style={mo.langBar}>
          <label style={mo.langLabel}>
            Language of this text
            <select value={lang} onChange={e => setLang(e.target.value)} style={mo.select}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label} ({l.code})</option>)}
            </select>
          </label>
        </div>

        <div style={mo.filterBar}>
          <select
            value={sigFilter}
            onChange={e => { setSigFilter(e.target.value); setPage(1); }}
            style={{ ...mo.select, width: 140 }}
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
            style={mo.searchInput}
          />
          <span style={{ color: '#888', fontSize: 12, whiteSpace: 'nowrap' }}>
            {data ? `${data.total.toLocaleString()} strings` : ''}
          </span>
        </div>

        <div style={mo.tableWrap}>
          {isLoading ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>Loading...</div>
          ) : (
            <table style={mo.table}>
              <thead>
                <tr>
                  <th style={mo.th}>Signature</th>
                  <th style={mo.th}>FormID</th>
                  <th style={mo.th}>EDID</th>
                  <th style={mo.th}>Path</th>
                  <th style={{ ...mo.th, minWidth: 280 }}>Source</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows ?? []).map((r: ModPreviewRow, i: number) => (
                  <tr key={i}>
                    <td style={mo.td}><code style={{ color: '#8cb4ff' }}>{r.signature}</code></td>
                    <td style={mo.td}><code style={{ color: '#aaa' }}>{r.formId}</code></td>
                    <td style={{ ...mo.td, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.edid}>{r.edid || '—'}</td>
                    <td style={mo.td}>{r.path}</td>
                    <td style={mo.td}>{r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div style={mo.pagination}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={mo.pageBtn}>← Prev</button>
            <span style={{ color: '#aaa', fontSize: 13 }}>Page {page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={mo.pageBtn}>Next →</button>
          </div>
        )}

        <div style={mo.footer}>
          <button onClick={onClose} style={{ ...st.btn, background: '#444' }}>Cancel</button>
          <button
            onClick={() => onConfirm(lang)}
            style={{ ...st.btn, background: '#1b6b2d', marginLeft: 12 }}
          >
            Import as {lang} ({job.total_records.toLocaleString()} strings)
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

const statusLabel = (status: string): string => {
  switch (status) {
    case 'pending': return 'Pending';
    case 'extracting': return 'Extracting...';
    case 'in_progress': return 'In progress';
    case 'paused': return 'Paused';
    case 'failed': return 'Failed';
    case 'completed': return 'Completed';
    default: return status;
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

const st = {
  page: { padding: '24px 32px', maxWidth: 960, margin: '0 auto' } as React.CSSProperties,
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#bbb' } as React.CSSProperties,
  title: { color: '#eee', marginBottom: 24 } as React.CSSProperties,
  uploadBar: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#1a1a1a', borderRadius: 8, marginBottom: 24 } as React.CSSProperties,
  fileInput: { flex: 1, color: '#ccc', fontSize: 13 } as React.CSSProperties,
  btn: { padding: '6px 16px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600 } as React.CSSProperties,
  list: { display: 'flex', flexDirection: 'column' as const, gap: 8 } as React.CSSProperties,
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#141414', borderRadius: 6, border: '1px solid #2a2a2a' } as React.CSSProperties,
  rowLeft: { display: 'flex', flexDirection: 'column' as const, gap: 2, minWidth: 0 } as React.CSSProperties,
  rowRight: { display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 } as React.CSSProperties,
  fileName: { color: '#ddd', fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 } as React.CSSProperties,
  meta: { color: '#888', fontSize: 12 } as React.CSSProperties,
  badge: { display: 'inline-block', padding: '2px 10px', borderRadius: 10, color: '#fff', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' as const } as React.CSSProperties,
  locBadge: { display: 'inline-block', padding: '1px 6px', borderRadius: 4, background: '#1565c0', color: '#fff', fontSize: 10, fontWeight: 600 } as React.CSSProperties,
  progressWrap: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 140 } as React.CSSProperties,
  progressTrack: { flex: 1, height: 6, background: '#333', borderRadius: 3, overflow: 'hidden' as const } as React.CSSProperties,
  progressFill: { height: '100%', background: '#4caf50', borderRadius: 3, transition: 'width 0.3s ease' } as React.CSSProperties,
  progressLabel: { color: '#aaa', fontSize: 12, minWidth: 32, textAlign: 'right' as const } as React.CSSProperties,
  actions: { display: 'flex', gap: 4 } as React.CSSProperties,
  actionBtn: { background: 'none', border: '1px solid #333', borderRadius: 4, color: '#ccc', cursor: 'pointer', padding: '4px 8px', fontSize: 14, lineHeight: 1 } as React.CSSProperties,
};

const mo = {
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 } as React.CSSProperties,
  modal: { background: '#1a1a1a', borderRadius: 12, width: '90vw', maxWidth: 1100, maxHeight: '90vh', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' } as React.CSSProperties,
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '16px 24px', borderBottom: '1px solid #333' } as React.CSSProperties,
  closeBtn: { background: 'none', border: 'none', color: '#888', fontSize: 20, cursor: 'pointer', padding: 4 } as React.CSSProperties,
  langBar: { display: 'flex', alignItems: 'flex-end', gap: 0, padding: '16px 24px 8px', flexWrap: 'wrap' as const } as React.CSSProperties,
  langLabel: { display: 'flex', flexDirection: 'column' as const, gap: 4, color: '#aaa', fontSize: 12, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em' } as React.CSSProperties,
  select: { background: '#222', color: '#ddd', border: '1px solid #444', borderRadius: 4, padding: '6px 10px', fontSize: 13 } as React.CSSProperties,
  filterBar: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 24px 8px' } as React.CSSProperties,
  searchInput: { flex: 1, background: '#222', color: '#ddd', border: '1px solid #444', borderRadius: 4, padding: '6px 10px', fontSize: 13 } as React.CSSProperties,
  tableWrap: { flex: 1, overflow: 'auto', padding: '0 24px' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 } as React.CSSProperties,
  th: { textAlign: 'left' as const, color: '#999', fontSize: 11, padding: '6px 8px', borderBottom: '1px solid #333', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em', position: 'sticky' as const, top: 0, background: '#1a1a1a' } as React.CSSProperties,
  td: { padding: '5px 8px', borderBottom: '1px solid #222', color: '#ccc', verticalAlign: 'top' as const } as React.CSSProperties,
  pagination: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, padding: '10px 24px' } as React.CSSProperties,
  pageBtn: { background: '#222', color: '#ccc', border: '1px solid #444', borderRadius: 4, padding: '4px 12px', fontSize: 13, cursor: 'pointer' } as React.CSSProperties,
  footer: { display: 'flex', justifyContent: 'flex-end', padding: '12px 24px', borderTop: '1px solid #333' } as React.CSSProperties,
};
