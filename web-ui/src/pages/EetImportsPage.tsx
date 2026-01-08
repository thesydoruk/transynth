import { useState, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type EetImportJob, type EetProgressEvent } from '../api';

type LiveProgress = { imported: number; total: number };

export function EetImportsPage() {
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

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['eet-imports'] }), [qc]);

  // ── Upload ────────────────────────────────────────────────────────────────
  const handleUpload = async () => {
    const files = fileRef.current?.files;
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        await api.eet.upload(f);
      }
      refresh();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // ── Start import ──────────────────────────────────────────────────────────
  const startImport = (jobId: number) => {
    const { promise, abort } = api.eet.startImport(jobId, (e: EetProgressEvent) => {
      setLiveProgress(prev => ({ ...prev, [jobId]: { imported: e.imported, total: e.total } }));
    });
    abortRefs.current[jobId] = abort;

    promise
      .then(() => {
        setLiveProgress(prev => { const copy = { ...prev }; delete copy[jobId]; return copy; });
        delete abortRefs.current[jobId];
        refresh();
      })
      .catch(() => {
        setLiveProgress(prev => { const copy = { ...prev }; delete copy[jobId]; return copy; });
        delete abortRefs.current[jobId];
        refresh();
      });

    // Mark as running immediately in local state
    refresh();
  };

  const startMultiple = () => {
    const pending = (jobs ?? []).filter(j => j.status === 'pending' || j.status === 'paused' || j.status === 'failed');
    for (const j of pending) startImport(j.id);
  };

  // ── Pause / Cancel ────────────────────────────────────────────────────────
  const handlePause = async (jobId: number) => {
    await api.eet.pause(jobId);
  };

  const handleCancel = async (jobId: number) => {
    await api.eet.cancel(jobId);
  };

  const handleDelete = async (jobId: number) => {
    await api.eet.remove(jobId);
    refresh();
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (isLoading) return <div style={s.center}>Loading...</div>;
  if (error) return <div style={{ ...s.center, color: '#f44' }}>Error: {String(error)}</div>;

  const pendingCount = (jobs ?? []).filter(j =>
    j.status === 'pending' || j.status === 'paused' || j.status === 'failed',
  ).length;

  return (
    <div style={s.page}>
      <h1 style={s.title}>EET Imports</h1>

      {/* Upload bar */}
      <div style={s.uploadBar}>
        <input
          ref={fileRef}
          type="file"
          accept=".eet"
          multiple
          style={s.fileInput}
        />
        <button onClick={handleUpload} disabled={uploading} style={s.btn}>
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
        {pendingCount > 0 && (
          <button onClick={startMultiple} style={{ ...s.btn, marginLeft: 8, background: '#1b6b2d' }}>
            Import all ({pendingCount})
          </button>
        )}
      </div>

      {/* Job list */}
      {!jobs?.length ? (
        <p style={{ color: '#888', marginTop: 32 }}>
          No EET files uploaded yet. Upload <code>.eet</code> files to get started.
        </p>
      ) : (
        <div style={s.list}>
          {jobs.map(job => (
            <JobRow
              key={job.id}
              job={job}
              live={liveProgress[job.id]}
              isRunning={job.running || !!liveProgress[job.id]}
              onStart={() => startImport(job.id)}
              onPause={() => handlePause(job.id)}
              onCancel={() => handleCancel(job.id)}
              onDelete={() => handleDelete(job.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Job row ───────────────────────────────────────────────────────────────────

function JobRow({
  job,
  live,
  isRunning,
  onStart,
  onPause,
  onCancel,
  onDelete,
}: {
  job: EetImportJob;
  live?: LiveProgress;
  isRunning: boolean;
  onStart: () => void;
  onPause: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const imported = live?.imported ?? job.imported_records;
  const total = live?.total ?? job.total_records;
  const pct = total > 0 ? Math.round((imported / total) * 100) : 0;

  const canStart = !isRunning && job.status !== 'completed' && job.status !== 'in_progress';
  const canPause = isRunning;
  const canCancel = isRunning;
  const canDelete = !isRunning;

  return (
    <div style={s.row}>
      {/* Left: file info */}
      <div style={s.rowLeft}>
        <span style={s.fileName}>{job.file_name}</span>
        <span style={s.meta}>
          {job.src_lang} → {job.tgt_lang} &middot; {total.toLocaleString()} records
        </span>
      </div>

      {/* Right: progress + controls */}
      <div style={s.rowRight}>
        {/* Status / progress */}
        {job.status === 'completed' ? (
          <span style={{ ...s.badge, background: '#1b6b2d' }}>Completed</span>
        ) : isRunning ? (
          <div style={s.progressWrap}>
            <div style={s.progressTrack}>
              <div style={{ ...s.progressFill, width: `${pct}%` }} />
            </div>
            <span style={s.progressLabel}>{pct}%</span>
          </div>
        ) : (
          <span style={{ ...s.badge, background: statusColor(job.status) }}>
            {statusLabel(job.status)}
            {job.imported_records > 0 && ` (${pct}%)`}
          </span>
        )}

        {/* Action buttons */}
        <div style={s.actions}>
          {canStart && (
            <button onClick={onStart} style={s.actionBtn} title="Start import">
              ▶
            </button>
          )}
          {canPause && (
            <button onClick={onPause} style={s.actionBtn} title="Pause">
              ⏸
            </button>
          )}
          {canCancel && (
            <button onClick={onCancel} style={{ ...s.actionBtn, color: '#f44' }} title="Cancel">
              ⏹
            </button>
          )}
          {canDelete && (
            <button onClick={onDelete} style={{ ...s.actionBtn, color: '#999' }} title="Delete">
              🗑
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case 'pending': return '#555';
    case 'in_progress': return '#1565c0';
    case 'paused': return '#e65100';
    case 'failed': return '#b71c1c';
    case 'completed': return '#1b6b2d';
    default: return '#555';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'pending': return 'Pending';
    case 'in_progress': return 'In progress';
    case 'paused': return 'Paused';
    case 'failed': return 'Failed';
    case 'completed': return 'Completed';
    default: return status;
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  page: { padding: '24px 32px', maxWidth: 960, margin: '0 auto' } as React.CSSProperties,
  center: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '60vh', color: '#bbb',
  } as React.CSSProperties,
  title: { color: '#eee', marginBottom: 24 } as React.CSSProperties,

  uploadBar: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 16px', background: '#1a1a1a',
    borderRadius: 8, marginBottom: 24,
  } as React.CSSProperties,
  fileInput: { flex: 1, color: '#ccc', fontSize: 13 } as React.CSSProperties,
  btn: {
    padding: '6px 16px', background: '#1565c0', color: '#fff',
    border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600,
  } as React.CSSProperties,

  list: { display: 'flex', flexDirection: 'column' as const, gap: 8 } as React.CSSProperties,
  row: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 16px', background: '#141414',
    borderRadius: 6, border: '1px solid #2a2a2a',
  } as React.CSSProperties,
  rowLeft: {
    display: 'flex', flexDirection: 'column' as const, gap: 2, minWidth: 0,
  } as React.CSSProperties,
  rowRight: {
    display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
  } as React.CSSProperties,

  fileName: { color: '#ddd', fontWeight: 600, fontSize: 14 } as React.CSSProperties,
  meta: { color: '#888', fontSize: 12 } as React.CSSProperties,

  badge: {
    display: 'inline-block', padding: '2px 10px', borderRadius: 10,
    color: '#fff', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,

  progressWrap: {
    display: 'flex', alignItems: 'center', gap: 8, minWidth: 140,
  } as React.CSSProperties,
  progressTrack: {
    flex: 1, height: 6, background: '#333', borderRadius: 3, overflow: 'hidden' as const,
  } as React.CSSProperties,
  progressFill: {
    height: '100%', background: '#4caf50', borderRadius: 3,
    transition: 'width 0.3s ease',
  } as React.CSSProperties,
  progressLabel: { color: '#aaa', fontSize: 12, minWidth: 32, textAlign: 'right' as const } as React.CSSProperties,

  actions: { display: 'flex', gap: 4 } as React.CSSProperties,
  actionBtn: {
    background: 'none', border: '1px solid #333', borderRadius: 4,
    color: '#ccc', cursor: 'pointer', padding: '4px 8px', fontSize: 14,
    lineHeight: 1,
  } as React.CSSProperties,
};
