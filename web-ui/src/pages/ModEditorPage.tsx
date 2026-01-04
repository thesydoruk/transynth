import { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type StringRow } from '../api';
import { StatusBadge, ProgressBar } from '../components/StatusBadge';
import { InlineEditor } from '../components/InlineEditor';

const STATUS_OPTS = ['all', 'untranslated', 'fuzzy', 'auto', 'tm', 'human'];
const PAGE_SIZE = 50;

type TranslateProgress = { done: number; total: number };

export function ModEditorPage() {
  const { id } = useParams<{ id: string }>();
  const modId = Number(id);
  const qc = useQueryClient();

  const [status, setStatus] = useState('all');
  const [signature, setSignature] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [translateProgress, setTranslateProgress] = useState<TranslateProgress | null>(null);
  const [showSearchReplace, setShowSearchReplace] = useState(false);

  const stringsKey = ['strings', modId, status, signature, query, page];

  const { data: mod } = useQuery({ queryKey: ['mods', modId], queryFn: () => api.mods.get(modId) });
  const { data: sigs } = useQuery({ queryKey: ['sigs', modId], queryFn: () => api.strings.signatures(modId) });
  const { data: stats, refetch: refetchStats } = useQuery({ queryKey: ['stats', modId], queryFn: () => api.stats.mod(modId) });
  const { data: strings, isLoading } = useQuery({
    queryKey: stringsKey,
    queryFn: () => api.strings.list({ modId, status: status === 'all' ? undefined : status, signature: signature || undefined, q: query || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  // SSE-streaming batch translate
  const [translateError, setTranslateError] = useState<string | null>(null);
  const translateInFlight = useRef(false);

  async function handleBatchTranslate() {
    if (translateInFlight.current) return;
    translateInFlight.current = true;
    setTranslateError(null);
    setTranslateProgress({ done: 0, total: selected.size });
    try {
      await api.strings.batchTranslate([...selected], 'uk', (e) => {
        setTranslateProgress({ done: e.done, total: e.total });
      });
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      void refetchStats();
      setSelected(new Set());
    } catch (err) {
      setTranslateError(String(err));
    } finally {
      setTranslateProgress(null);
      translateInFlight.current = false;
    }
  }

  const tmApply = useMutation({
    mutationFn: () => api.mods.tmApply(modId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      void refetchStats();
    },
  });

  const totalPages = strings ? Math.ceil(strings.total / PAGE_SIZE) : 1;

  function toggleRow(row: StringRow) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(row.string_id)) next.delete(row.string_id);
      else next.add(row.string_id);
      return next;
    });
  }

  function toggleAll() {
    if (!strings) return;
    if (selected.size === strings.rows.length) setSelected(new Set());
    else setSelected(new Set(strings.rows.map((r) => r.string_id)));
  }

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <div>
          <h1 style={s.title}>{mod?.name ?? '…'}</h1>
          <span style={{ color: '#888', fontSize: 12 }}>{mod?.abs_path}</span>
        </div>
        {stats && (
          <div style={{ minWidth: 200 }}>
            <ProgressBar stats={stats} />
            <div style={s.statRow}>
              {([['Total', stats.total], ['Approved', stats.approved, '#4caf50'], ['Fuzzy', stats.fuzzy, '#00bcd4'], ['Auto', stats.auto_translated, '#ff9800'], ['Untranslated', stats.untranslated, '#888']] as [string, number, string?][]).map(([label, val, color]) => (
                <span key={label} style={{ color: color ?? '#bbb', fontSize: 12 }}>
                  {label}: <strong>{val}</strong>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div style={s.filters}>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} style={s.select}>
          {STATUS_OPTS.map((o) => <option key={o} value={o}>{o === 'all' ? 'All statuses' : o}</option>)}
        </select>
        <select value={signature} onChange={(e) => { setSignature(e.target.value); setPage(1); }} style={s.select}>
          <option value="">All types</option>
          {sigs?.map((sig) => <option key={sig.signature} value={sig.signature}>{sig.signature} ({sig.count})</option>)}
        </select>
        <input placeholder="Search text / FormID / EDID…" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} style={s.input} />
        <button
          onClick={() => tmApply.mutate()}
          disabled={tmApply.isPending}
          style={s.btnSecondary}
          title="Apply Translation Memory — auto-fill untranslated strings from existing translations"
        >
          {tmApply.isPending ? 'Applying TM…' : tmApply.isSuccess ? `TM ✓ ${(tmApply.data as { applied: number }).applied}` : 'Apply TM'}
        </button>
        <button onClick={() => setShowSearchReplace(true)} style={s.btnSecondary}>Search & Replace</button>
        {selected.size > 0 && (
          translateProgress
            ? <span style={s.progressBadge}>{translateProgress.done}/{translateProgress.total} translating…</span>
            : <button onClick={handleBatchTranslate} style={s.btnPrimary}>Auto-translate {selected.size}</button>
        )}
        {translateError && <span style={{ color: '#f44', fontSize: 12 }}>{translateError}</span>}
      </div>

      {/* Search-Replace Modal */}
      {showSearchReplace && (
        <SearchReplaceModal modId={modId} onClose={() => setShowSearchReplace(false)} onApplied={() => { qc.invalidateQueries({ queryKey: ['strings', modId] }); }} />
      )}

      {/* Table */}
      {isLoading ? (
        <div style={s.center}>Loading…</div>
      ) : (
        <>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={{ ...s.th, width: 28 }}><input type="checkbox" checked={!!strings?.rows.length && selected.size === strings.rows.length} onChange={toggleAll} /></th>
                <th style={s.th}>FormID</th>
                <th style={s.th}>Type</th>
                <th style={{ ...s.th, minWidth: 200 }}>Source (EN)</th>
                <th style={{ ...s.th, minWidth: 200 }}>Translation (UK)</th>
                <th style={s.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {strings?.rows.map((row) => (
                <tr key={row.string_id} style={s.tr}>
                  <td style={s.td}><input type="checkbox" checked={selected.has(row.string_id)} onChange={() => toggleRow(row)} /></td>
                  <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11, color: '#888' }}>{row.formid_hex}</td>
                  <td style={{ ...s.td, fontSize: 11 }}><span style={{ color: '#aaa' }}>{row.signature}</span></td>
                  <td style={{ ...s.td, maxWidth: 300, wordBreak: 'break-word', whiteSpace: 'pre-wrap', fontSize: 13 }}>{row.source}</td>
                  <td style={{ ...s.td, maxWidth: 320 }}>
                    <InlineEditor stringId={row.string_id} translationId={row.translation_id} text={row.translation} status={row.status} queryKey={stringsKey} />
                  </td>
                  <td style={s.td}><StatusBadge status={row.status} small /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={s.pagination}>
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} style={s.pageBtn}>← Prev</button>
            <span style={{ color: '#aaa', fontSize: 13 }}>Page {page} / {totalPages} ({strings?.total ?? 0} strings)</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} style={s.pageBtn}>Next →</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Search & Replace Modal ────────────────────────────────────────────────────

type SRProps = { modId: number; onClose: () => void; onApplied: () => void };

function SearchReplaceModal({ modId, onClose, onApplied }: SRProps) {
  const [search, setSearch] = useState('');
  const [replace, setReplace] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [previewResult, setPreviewResult] = useState<{ matches: Array<{ originalText: string; newText: string; formid_hex: string }>; applied: number } | null>(null);
  const [stage, setStage] = useState<'idle' | 'previewing' | 'applying' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handlePreview() {
    if (!search) return;
    setStage('previewing'); setError(null);
    try {
      const r = await api.search.replace(modId, { search, replace, isRegex, dryRun: true });
      setPreviewResult(r);
      setStage('idle');
    } catch (err) { setError(String(err)); setStage('idle'); }
  }

  async function handleApply() {
    if (!search) return;
    setStage('applying'); setError(null);
    try {
      const r = await api.search.replace(modId, { search, replace, isRegex, dryRun: false });
      setPreviewResult(r);
      setStage('done');
      onApplied();
    } catch (err) { setError(String(err)); setStage('idle'); }
  }

  return (
    <div style={modal.overlay} onClick={onClose}>
      <div style={modal.box} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ color: '#eee', margin: '0 0 16px' }}>Search & Replace Translations</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} style={modal.input} />
          <input placeholder="Replace with…" value={replace} onChange={(e) => setReplace(e.target.value)} style={modal.input} />
          <label style={{ color: '#aaa', fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={isRegex} onChange={(e) => setIsRegex(e.target.checked)} /> Use regex
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={handlePreview} disabled={stage !== 'idle' || !search} style={modal.btn('#444')}>Preview ({previewResult?.matches.length ?? 0})</button>
          <button onClick={handleApply} disabled={stage !== 'idle' || !search} style={modal.btn('#1565c0')}>Apply</button>
          <button onClick={onClose} style={modal.btn('#333')}>Cancel</button>
        </div>
        {error && <p style={{ color: '#f44', fontSize: 12, marginTop: 8 }}>{error}</p>}
        {stage === 'done' && <p style={{ color: '#4caf50', fontSize: 13, marginTop: 8 }}>Applied {previewResult?.applied} replacements</p>}
        {previewResult && stage !== 'done' && previewResult.matches.length > 0 && (
          <div style={{ marginTop: 12, maxHeight: 200, overflowY: 'auto', fontSize: 12 }}>
            {previewResult.matches.slice(0, 20).map((m, i) => (
              <div key={i} style={{ borderBottom: '1px solid #2a2a2a', padding: '4px 0' }}>
                <span style={{ color: '#888', marginRight: 8 }}>{m.formid_hex}</span>
                <span style={{ color: '#f88' }}>{m.originalText.slice(0, 60)}</span>
                {' → '}
                <span style={{ color: '#8f8' }}>{m.newText.slice(0, 60)}</span>
              </div>
            ))}
            {previewResult.matches.length > 20 && <p style={{ color: '#888' }}>…and {previewResult.matches.length - 20} more</p>}
          </div>
        )}
      </div>
    </div>
  );
}

const modal = {
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  box: { background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, padding: 24, minWidth: 440, maxWidth: 600 },
  input: { background: '#252525', color: '#ccc', border: '1px solid #444', borderRadius: 4, padding: '6px 10px', fontSize: 13, width: '100%' } as React.CSSProperties,
  btn: (bg: string) => ({ background: bg, color: '#fff', border: 'none', borderRadius: 4, padding: '7px 16px', cursor: 'pointer', fontSize: 13 }) as React.CSSProperties,
};

const s = {
  page: { padding: '16px 24px' } as React.CSSProperties,
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 24, flexWrap: 'wrap' as const } as React.CSSProperties,
  title: { color: '#eee', margin: 0, marginBottom: 4 } as React.CSSProperties,
  statRow: { display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' as const } as React.CSSProperties,
  filters: { display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' as const, alignItems: 'center' } as React.CSSProperties,
  select: { background: '#222', color: '#ccc', border: '1px solid #444', borderRadius: 4, padding: '5px 8px', fontSize: 13 } as React.CSSProperties,
  input: { background: '#222', color: '#ccc', border: '1px solid #444', borderRadius: 4, padding: '5px 10px', fontSize: 13, flex: 1, minWidth: 200 } as React.CSSProperties,
  btnPrimary: { background: '#1565c0', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 } as React.CSSProperties,
  btnSecondary: { background: '#2a2a2a', color: '#ccc', border: '1px solid #444', borderRadius: 4, padding: '6px 14px', cursor: 'pointer', fontSize: 13 } as React.CSSProperties,
  progressBadge: { background: '#1a3a5c', color: '#7cc8ff', borderRadius: 4, padding: '5px 12px', fontSize: 13 } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 } as React.CSSProperties,
  th: { textAlign: 'left' as const, color: '#888', fontSize: 11, padding: '6px 8px', borderBottom: '1px solid #333', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em' } as React.CSSProperties,
  tr: { borderBottom: '1px solid #1a1a1a' } as React.CSSProperties,
  td: { padding: '8px', verticalAlign: 'top' as const } as React.CSSProperties,
  center: { padding: 32, textAlign: 'center' as const, color: '#888' } as React.CSSProperties,
  pagination: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, marginTop: 24, paddingBottom: 32 } as React.CSSProperties,
  pageBtn: { background: '#333', color: '#ccc', border: 'none', borderRadius: 4, padding: '6px 14px', cursor: 'pointer', fontSize: 13 } as React.CSSProperties,
};
