import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { api, type QAIssue, type StringRow, type TMSuggestion, type TranslationHistoryEntry } from '../api';
import { StatusBadge, ProgressBar } from '../components/StatusBadge';

const STATUS_OPTS = ['all', 'untranslated', 'draft', 'reviewed', 'rejected', 'fuzzy', 'auto', 'tm', 'human'];
const PAGE_SIZE = 100;

type TranslateProgress = { done: number; total: number };
type BottomTab = 'suggestions' | 'qa' | 'history';

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
}

// Row background by translation status
const rowBg = (status: string | null): string => {
  if (!status) return '#3d1e00'; // untranslated → orange-ish
  if (status === 'reviewed' || status === 'human') return 'transparent';
  if (status === 'draft') return '#183a18';
  if (status === 'rejected') return '#3b1616';
  if (status === 'tm') return '#003d45';   // teal
  if (status === 'auto') return '#003d45'; // teal
  if (status === 'fuzzy') return '#3d3100'; // amber
  return 'transparent';
}

export const ModEditorPage = () => {
  const { id } = useParams<{ id: string }>();
  const modId = Number(id);
  const qc = useQueryClient();

  // Filters
  const [srcLang, setSrcLang] = useState('en');
  const [targetLang, setTargetLang] = useState('uk');
  const [status, setStatus] = useState('all');
  const [signature, setSignature] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  // Selection
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Active row (detail panel)
  const [activeRow, setActiveRow] = useState<StringRow | null>(null);
  const [draftTranslation, setDraftTranslation] = useState('');
  const [activeTab, setActiveTab] = useState<BottomTab>('suggestions');
  const [saveIndicator, setSaveIndicator] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Autosave refs
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRowRef = useRef(activeRow);
  const draftRef = useRef(draftTranslation);
  activeRowRef.current = activeRow;
  draftRef.current = draftTranslation;

  // Translate progress
  const [translateProgress, setTranslateProgress] = useState<TranslateProgress | null>(null);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const translateInFlight = useRef(false);

  // Search & Replace
  const [showSearchReplace, setShowSearchReplace] = useState(false);

  // Virtualizer
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: strings?.rows.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  const stringsKey = ['strings', modId, srcLang, targetLang, status, signature, query, page];

  const { data: mod } = useQuery({ queryKey: ['mods', modId], queryFn: () => api.mods.get(modId) });
  const { data: langs } = useQuery({ queryKey: ['langs', modId], queryFn: () => api.mods.langs(modId) });
  const { data: sigs } = useQuery({ queryKey: ['sigs', modId, srcLang], queryFn: () => api.strings.signatures(modId, srcLang) });
  const { data: stats, refetch: refetchStats } = useQuery({ queryKey: ['stats', modId], queryFn: () => api.stats.mod(modId) });
  const { data: strings, isLoading } = useQuery({
    queryKey: stringsKey,
    queryFn: () => api.strings.list({ modId, srcLang, targetLang, status: status === 'all' ? undefined : status, signature: signature || undefined, q: query || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  // TM suggestions for active row
  const { data: suggestions } = useQuery({
    queryKey: ['suggestions', activeRow?.string_id, targetLang],
    queryFn: () => api.strings.suggestions(activeRow!.string_id, targetLang),
    enabled: !!activeRow && activeTab === 'suggestions',
  });
  const { data: qaIssues } = useQuery({
    queryKey: ['qa', activeRow?.string_id, targetLang],
    queryFn: () => api.strings.qa(activeRow!.string_id, targetLang),
    enabled: !!activeRow && activeTab === 'qa',
  });
  const { data: history } = useQuery({
    queryKey: ['history', activeRow?.string_id, targetLang],
    queryFn: () => api.strings.history(activeRow!.string_id, targetLang),
    enabled: !!activeRow && activeTab === 'history',
  });

  // Save translation
  const saveMutation = useMutation({
    mutationFn: ({ stringId, text }: { stringId: number; text: string }) =>
      api.strings.saveTranslation(stringId, text, 'draft', targetLang),
    onMutate: ({ stringId, text }) => {
      // Optimistic update in the grid cache
      qc.setQueriesData<{ rows: StringRow[]; total: number }>({ queryKey: ['strings', modId] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          rows: old.rows.map((r) =>
            r.string_id === stringId ? { ...r, translation: text || null, status: text ? 'draft' : null } : r,
          ),
        };
      });
      setSaveIndicator('saving');
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      qc.invalidateQueries({ queryKey: ['history'] });
      qc.invalidateQueries({ queryKey: ['qa'] });
      void refetchStats();
      // Update active row locally
      if (activeRowRef.current?.string_id === result.id || (activeRowRef.current && result.id)) {
        setActiveRow((prev) =>
          prev
            ? { ...prev, translation: result.text, translation_id: result.id, status: 'draft' }
            : prev,
        );
      }
      setSaveIndicator('saved');
      setTimeout(() => setSaveIndicator('idle'), 1500);
    },
    onError: () => {
      setSaveIndicator('idle');
    },
  });

  // Approve
  const approveMutation = useMutation({
    mutationFn: ({ stringId, translationId }: { stringId: number; translationId: number }) =>
      api.strings.updateStatus(stringId, translationId, 'reviewed'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      qc.invalidateQueries({ queryKey: ['history'] });
      qc.invalidateQueries({ queryKey: ['qa'] });
      void refetchStats();
      if (activeRow) {
        setActiveRow({ ...activeRow, status: 'reviewed' });
      }
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ stringId, translationId }: { stringId: number; translationId: number }) =>
      api.strings.updateStatus(stringId, translationId, 'rejected'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      qc.invalidateQueries({ queryKey: ['history'] });
      qc.invalidateQueries({ queryKey: ['qa'] });
      void refetchStats();
      if (activeRow) {
        setActiveRow({ ...activeRow, status: 'rejected' });
      }
    },
  });

  // Clear translation
  const clearMutation = useMutation({
    mutationFn: ({ stringId }: { stringId: number }) =>
      api.strings.clearTranslation(stringId, targetLang),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      qc.invalidateQueries({ queryKey: ['history'] });
      qc.invalidateQueries({ queryKey: ['qa'] });
      void refetchStats();
      if (activeRow) setActiveRow({ ...activeRow, translation: null, status: null });
    },
  });

  const tmApply = useMutation({
    mutationFn: () => api.mods.tmApply(modId, srcLang, targetLang),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      void refetchStats();
    },
  });

  const exportStrings = useMutation({
    mutationFn: () => api.mods.exportStrings(modId, srcLang, targetLang),
    onSuccess: (result) => {
      for (const file of result.files) {
        downloadBase64File(file.fileName, file.contentBase64);
      }
    },
  });

  const exportEsp = useMutation({
    mutationFn: () => api.mods.exportEsp(modId, srcLang, targetLang),
    onSuccess: (result) => {
      for (const file of result.files) {
        downloadBase64File(file.fileName, file.contentBase64);
      }
    },
  });

  const exportBa2 = useMutation({
    mutationFn: () => api.mods.exportBa2(modId, srcLang, targetLang),
    onSuccess: (result) => {
      for (const file of result.files) {
        downloadBase64File(file.fileName, file.contentBase64);
      }
    },
  });

  const bulkReviewMutation = useMutation({
    mutationFn: ({ status }: { status: 'reviewed' | 'rejected' }) =>
      api.mods.bulkReview(modId, [...selected], status, targetLang),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      qc.invalidateQueries({ queryKey: ['history'] });
      qc.invalidateQueries({ queryKey: ['qa'] });
      void refetchStats();
      setSelected(new Set());
    },
  });

  // Flush pending autosave immediately (used before row switch)
  const flushAutosave = () => {
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    const row = activeRowRef.current;
    const text = draftRef.current;
    if (!row) return;
    const original = row.translation ?? '';
    if (text === original) return;
    if (text.trim() === '') {
      clearMutation.mutate({ stringId: row.string_id });
    } else {
      saveMutation.mutate({ stringId: row.string_id, text });
    }
  }

  const handleRowClick = (row: StringRow) => {
    flushAutosave();
    setActiveRow(row);
    setDraftTranslation(row.translation ?? '');
    setActiveTab('suggestions');
  }

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Skip when typing in input/textarea/select (except Escape)
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

      // Escape — close detail panel or clear selection
      if (e.key === 'Escape') {
        e.preventDefault();
        if (activeRow) { flushAutosave(); setActiveRow(null); setDraftTranslation(''); }
        else if (selected.size > 0) setSelected(new Set());
        return;
      }

      // Ctrl+Shift+A — approve active row
      if (e.key === 'A' && e.ctrlKey && e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (activeRow?.translation_id && activeRow.status !== 'reviewed' && activeRow.status !== 'human') {
          handleApprove(activeRow);
        }
        return;
      }

      // Ctrl+Shift+R — reject active row
      if (e.key === 'R' && e.ctrlKey && e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (activeRow?.translation_id && activeRow.status !== 'rejected') {
          rejectMutation.mutate({ stringId: activeRow.string_id, translationId: activeRow.translation_id });
        }
        return;
      }

      // Arrow keys — navigate rows (only when not in a text field)
      if (isInput) return;
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && strings?.rows.length) {
        e.preventDefault();
        const rows = strings.rows;
        const curIdx = activeRow ? rows.findIndex((r) => r.string_id === activeRow.string_id) : -1;
        let nextIdx: number;
        if (e.key === 'ArrowDown') {
          nextIdx = curIdx < rows.length - 1 ? curIdx + 1 : 0;
        } else {
          nextIdx = curIdx > 0 ? curIdx - 1 : rows.length - 1;
        }
        handleRowClick(rows[nextIdx]);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeRow, selected, strings]);

  // Debounced autosave: triggers 800ms after typing stops
  useEffect(() => {
    if (!activeRow) return;
    const original = activeRow.translation ?? '';
    if (draftTranslation === original) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      autosaveTimer.current = null;
      handleSave();
    }, 800);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [draftTranslation]);

  const handleCopySource = () => {
    if (!activeRow) return;
    setDraftTranslation(activeRow.source);
  }

  const handleSave = () => {
    if (autosaveTimer.current) { clearTimeout(autosaveTimer.current); autosaveTimer.current = null; }
    if (!activeRow) return;
    if (draftTranslation.trim() === '') {
      handleClear(activeRow);
      return;
    }
    saveMutation.mutate({ stringId: activeRow.string_id, text: draftTranslation });
  }

  const handleApprove = (row: StringRow) => {
    if (!row.translation_id) return;
    approveMutation.mutate({ stringId: row.string_id, translationId: row.translation_id });
  }

  const handleClear = (row: StringRow) => {
    clearMutation.mutate({ stringId: row.string_id });
    if (activeRow?.string_id === row.string_id) {
      setActiveRow({ ...row, translation: null, translation_id: null, status: null, qa_issue_count: 0 });
      setDraftTranslation('');
    }
  }

  const toggleRow = useCallback((row: StringRow, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(row.string_id)) next.delete(row.string_id);
      else next.add(row.string_id);
      return next;
    });
  }, []);

  const toggleAll = () => {
    if (!strings) return;
    if (selected.size === strings.rows.length) setSelected(new Set());
    else setSelected(new Set(strings.rows.map((r) => r.string_id)));
  }

  const handleBatchTranslate = async () => {
    if (translateInFlight.current) return;
    translateInFlight.current = true;
    setTranslateError(null);
    setTranslateProgress({ done: 0, total: selected.size });
    try {
      await api.strings.batchTranslate([...selected], srcLang, targetLang, (e) => {
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

  const totalPages = strings ? Math.ceil(strings.total / PAGE_SIZE) : 1;

  // Group counts by signature for left panel
  const sigCounts = sigs ?? [];

  // Available langs derived from mod + fallback
  const availLangs = langs && langs.length > 0 ? langs : ['en', 'uk'];

  return (
    <div style={s.root}>
      {/* ── Top toolbar ── */}
      <div style={s.toolbar}>
        <span style={s.modName}>{mod?.name ?? '…'}</span>

        {/* Lang selectors */}
        <label style={s.langLabel}>
          Source:
          <select value={srcLang} onChange={(e) => { setSrcLang(e.target.value); setPage(1); }} style={s.langSelect}>
            {availLangs.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </label>
        <label style={s.langLabel}>
          Target:
          <select value={targetLang} onChange={(e) => { setTargetLang(e.target.value); setPage(1); }} style={s.langSelect}>
            {availLangs.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </label>

        <div style={s.sep} />

        {/* Status filter */}
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} style={s.filterSelect}>
          {STATUS_OPTS.map((o) => <option key={o} value={o}>{o === 'all' ? 'All statuses' : o}</option>)}
        </select>
        <button
          onClick={() => { setStatus(status === 'draft' ? 'all' : 'draft'); setPage(1); }}
          style={status === 'draft' ? s.btnPri : s.btnSec}
          title="Show only drafts for review"
        >
          Review mode{stats?.draft ? ` (${stats.draft})` : ''}
        </button>

        {/* Search */}
        <input placeholder="FormID / EDID / text…" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} style={s.searchInput} />

        <div style={s.sep} />

        {/* Actions */}
        <button onClick={() => tmApply.mutate()} disabled={tmApply.isPending} style={s.btnSec} title="Auto-fill from TM">
          {tmApply.isPending ? 'TM…' : tmApply.isSuccess ? `TM ✓ ${(tmApply.data as { applied: number }).applied}` : 'Apply TM'}
        </button>
        <button onClick={() => exportStrings.mutate()} disabled={exportStrings.isPending} style={s.btnSec} title="Generate localized STRINGS files from current translations">
          {exportStrings.isPending ? 'Export…' : 'Export STRINGS'}
        </button>
        <button onClick={() => exportEsp.mutate()} disabled={exportEsp.isPending} style={s.btnSec} title="Patch ESP with translations (non-localized mods)">
          {exportEsp.isPending ? 'Export…' : 'Export ESP'}
        </button>
        <button onClick={() => exportBa2.mutate()} disabled={exportBa2.isPending} style={s.btnSec} title="Pack localized STRINGS into BA2 archive">
          {exportBa2.isPending ? 'Export…' : 'Export BA2'}
        </button>
        <button onClick={() => setShowSearchReplace(true)} style={s.btnSec}>Search & Replace</button>
        {selected.size > 0 && (
          <>
            {translateProgress
              ? <span style={s.progressBadge}>{translateProgress.done}/{translateProgress.total} translating…</span>
              : <button onClick={handleBatchTranslate} style={s.btnPri}>Auto-translate {selected.size}</button>
            }
            <button
              onClick={() => bulkReviewMutation.mutate({ status: 'reviewed' })}
              disabled={bulkReviewMutation.isPending}
              style={s.btnApprove}
              title="Approve selected translations"
            >
              {bulkReviewMutation.isPending ? '…' : `Approve ${selected.size}`}
            </button>
            <button
              onClick={() => bulkReviewMutation.mutate({ status: 'rejected' })}
              disabled={bulkReviewMutation.isPending}
              style={s.btnDanger}
              title="Reject selected translations"
            >
              {bulkReviewMutation.isPending ? '…' : `Reject ${selected.size}`}
            </button>
          </>
        )}
        {translateError && <span style={s.errorBadge}>{translateError}</span>}
        {exportStrings.isError && <span style={s.errorBadge}>{String(exportStrings.error)}</span>}
        {exportEsp.isError && <span style={s.errorBadge}>{String(exportEsp.error)}</span>}
        {exportBa2.isError && <span style={s.errorBadge}>{String(exportBa2.error)}</span>}

        {/* Progress bar */}
        {stats && (
          <div style={{ marginLeft: 'auto', minWidth: 160, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <ProgressBar stats={stats} />
            <span style={{ fontSize: 11, color: '#888', textAlign: 'right' }}>
              {stats.approved}/{stats.total} approved
            </span>
          </div>
        )}
      </div>

      {/* ── 3-column body ── */}
      <div style={s.body}>

        {/* LEFT: signature tree */}
        <div style={s.leftPanel}>
          <div
            style={{ ...s.sigRow, ...(signature === '' ? s.sigRowActive : {}) }}
            onClick={() => { setSignature(''); setPage(1); }}
          >
            <span style={s.sigName}>&lt;ВСЕ&gt;</span>
            <span style={s.sigCount}>{strings?.total ?? '…'} / {sigCounts.reduce((a, r) => a + Number(r.count), 0)}</span>
          </div>
          {sigCounts.map((sig) => (
            <div
              key={sig.signature}
              style={{ ...s.sigRow, ...(signature === sig.signature ? s.sigRowActive : {}) }}
              onClick={() => { setSignature(sig.signature); setPage(1); }}
            >
              <span style={s.sigName}>{sig.signature}</span>
              <span style={s.sigCount}>{sig.count}</span>
            </div>
          ))}
        </div>

        {/* CENTER+RIGHT: table + detail panel */}
        <div style={s.centerCol}>

          {/* ── String table (virtualized) ── */}
          <div style={s.tableWrap} ref={scrollRef}>
            {isLoading ? (
              <div style={s.center}>Loading…</div>
            ) : (
              <>
                {/* Sticky header */}
                <div style={s.gridHeader}>
                  <div style={{ ...s.th, width: 24 }}>
                    <input type="checkbox" checked={!!strings?.rows.length && selected.size === strings.rows.length} onChange={toggleAll} />
                  </div>
                  <div style={{ ...s.th, width: 52 }}>GRUP</div>
                  <div style={{ ...s.th, width: 70 }}>FormID</div>
                  <div style={{ ...s.th, width: 160 }}>EDID</div>
                  <div style={{ ...s.th, width: 50 }}>FIELD</div>
                  <div style={{ ...s.th, flex: 1, minWidth: 220 }}>Текст оригіналу ({srcLang.toUpperCase()})</div>
                  <div style={{ ...s.th, flex: 1, minWidth: 220 }}>Текст перекладу ({targetLang.toUpperCase()})</div>
                  <div style={{ ...s.th, width: 74 }}>Дії</div>
                </div>
                {/* Virtualized rows */}
                <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                  {rowVirtualizer.getVirtualItems().map((vItem) => {
                    const row = strings!.rows[vItem.index];
                    const isActive = activeRow?.string_id === row.string_id;
                    return (
                      <div
                        key={row.string_id}
                        data-index={vItem.index}
                        ref={rowVirtualizer.measureElement}
                        style={{
                          ...s.gridRow,
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${vItem.start}px)`,
                          background: rowBg(isActive ? '__active' : row.status),
                          outline: isActive ? '1px solid #aaa' : 'none',
                          cursor: 'pointer',
                        }}
                        onClick={() => handleRowClick(row)}
                      >
                        <div style={{ ...s.td, width: 24 }} onClick={(e) => toggleRow(row, e)}>
                          <input type="checkbox" checked={selected.has(row.string_id)} onChange={() => {}} />
                        </div>
                        <div style={{ ...s.td, width: 52, color: '#999', fontSize: 11 }}>{row.signature}</div>
                        <div style={{ ...s.td, width: 70, fontFamily: 'monospace', fontSize: 11, color: '#777' }}>{row.formid_hex}</div>
                        <div style={{ ...s.td, width: 160, fontSize: 11, color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.edid ?? ''}>{row.edid ?? ''}</div>
                        <div style={{ ...s.td, width: 50, fontSize: 11, color: '#999' }}>{row.path?.split('.').pop() ?? ''}</div>
                        <div style={{ ...s.td, flex: 1, minWidth: 220, wordBreak: 'break-word', whiteSpace: 'pre-wrap', fontSize: 13 }}>{row.source}</div>
                        <div style={{ ...s.td, flex: 1, minWidth: 220, wordBreak: 'break-word', whiteSpace: 'pre-wrap', fontSize: 13, color: row.translation ? '#eee' : '#666', fontStyle: row.translation ? 'normal' : 'italic' }}>
                          {row.translation ?? '—'}
                          {row.qa_issue_count > 0 && (
                            <span style={s.qaHint}>{row.qa_issue_count} QA</span>
                          )}
                        </div>
                        <div style={{ ...s.td, width: 74 }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 3 }}>
                            {row.translation && row.status !== 'reviewed' && row.status !== 'human' && row.translation_id && (
                              <button style={s.actionBtn('#1565c0')} title="Підтвердити" onClick={() => handleApprove(row)}>V</button>
                            )}
                            {row.translation && row.status !== 'rejected' && row.translation_id && (
                              <button style={s.actionBtn('#7b1a1a')} title="Відхилити" onClick={() => rejectMutation.mutate({ stringId: row.string_id, translationId: row.translation_id! })}>R</button>
                            )}
                            <button style={s.actionBtn('#7b1a1a')} title="Очистити переклад" onClick={() => handleClear(row)}>X</button>
                            <button style={s.actionBtn('#2a5c2a')} title="Копіювати оригінал у переклад" onClick={() => { handleRowClick(row); setTimeout(() => setDraftTranslation(row.source), 0); }}>C</button>
                            <StatusBadge status={row.status} small />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* ── Pagination ── */}
          <div style={s.pagination}>
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} style={s.pageBtn}>← Prev</button>
            <span style={{ color: '#aaa', fontSize: 13 }}>Сторінка {page} / {totalPages} ({strings?.total ?? 0} рядків)</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} style={s.pageBtn}>Next →</button>
          </div>

          {/* ── Detail edit panel ── */}
          {activeRow && (
            <div style={s.detailPanel}>
              <div style={s.detailPanels}>
                {/* Source */}
                <div style={s.textPanel}>
                  <div style={s.panelLabel}>Текст оригіналу ({srcLang.toUpperCase()})</div>
                  <textarea readOnly value={activeRow.source} style={s.sourceArea} rows={4} />
                  <div style={s.charCount}>Символів: {activeRow.source.length}</div>
                </div>
                {/* Translation */}
                <div style={s.textPanel}>
                  <div style={s.panelLabel}>Текст перекладу ({targetLang.toUpperCase()})</div>
                  <textarea
                    value={draftTranslation}
                    onChange={(e) => setDraftTranslation(e.target.value)}
                    style={s.translArea}
                    rows={4}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSave(); }}
                    placeholder="Введіть переклад…"
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={s.charCount}>Символів: {draftTranslation.length}</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button style={s.btnSec} onClick={handleCopySource} title="Копіювати оригінал">Copy src</button>
                      {activeRow.translation && activeRow.translation_id && activeRow.status !== 'reviewed' && activeRow.status !== 'human' && (
                        <button style={s.btnSec} onClick={() => handleApprove(activeRow)}>
                          Review
                        </button>
                      )}
                      {activeRow.translation && activeRow.translation_id && activeRow.status !== 'rejected' && (
                        <button style={s.btnDanger} onClick={() => rejectMutation.mutate({ stringId: activeRow.string_id, translationId: activeRow.translation_id! })}>
                          Reject
                        </button>
                      )}
                      <button
                        style={s.btnPri}
                        onClick={handleSave}
                        disabled={saveMutation.isPending}
                        title="Ctrl+Enter"
                      >
                        {saveMutation.isPending ? 'Saving…' : saveIndicator === 'saved' ? '✓ Saved' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom tabs */}
              <div style={s.tabs}>
                {(['suggestions', 'qa', 'history'] as BottomTab[]).map((tab) => (
                  <button key={tab} style={{ ...s.tabBtn, ...(activeTab === tab ? s.tabBtnActive : {}) }} onClick={() => setActiveTab(tab)}>
                    {tab === 'suggestions' ? 'Пропозиції TM' : tab === 'qa' ? 'QA' : 'Історія'}
                  </button>
                ))}
              </div>
              <div style={s.tabContent}>
                {activeTab === 'suggestions' && (
                  <SuggestionsPanel suggestions={suggestions ?? []} onApply={(text) => setDraftTranslation(text)} />
                )}
                {activeTab === 'qa' && (
                  <QAPanel issues={qaIssues ?? []} />
                )}
                {activeTab === 'history' && (
                  <HistoryPanel items={history ?? []} />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Search-Replace Modal */}
      {showSearchReplace && (
        <SearchReplaceModal modId={modId} targetLang={targetLang} onClose={() => setShowSearchReplace(false)} onApplied={() => { qc.invalidateQueries({ queryKey: ['strings', modId] }); }} />
      )}

      {/* Status bar */}
      <div style={s.statusBar}>
        <span>Вибрані рядки: {selected.size}</span>
        {activeRow && (
          <span style={{ marginLeft: 16, color: '#888' }}>
            {activeRow.signature} · {activeRow.formid_hex} · {activeRow.edid ?? '—'}
          </span>
        )}
        {stats && (
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#888' }}>
            approved: {stats.approved} · draft: {stats.draft} · rejected: {stats.rejected} · tm: {stats.tm} · fuzzy: {stats.fuzzy} · auto: {stats.auto_translated} · untranslated: {stats.untranslated} · total: {stats.total}
          </span>
        )}
      </div>
    </div>
  );
}

// ── TM Suggestions panel ─────────────────────────────────────────────────────

const SuggestionsPanel = ({ suggestions, onApply }: { suggestions: TMSuggestion[]; onApply: (text: string) => void }) => {
  if (suggestions.length === 0) {
    return <div style={{ color: '#666', fontSize: 13, padding: 8 }}>Немає пропозицій TM</div>;
  }
  const methodLabel = (m: string) => m === 'exact' ? 'exact' : m === 'punct_norm' ? 'punct' : 'fuzzy';
  const methodColor = (m: string) => m === 'exact' ? '#4caf50' : m === 'punct_norm' ? '#ff9800' : '#2196f3';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {suggestions.map((s) => (
        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', background: '#1a1a1a', borderRadius: 4 }}>
          <StatusBadge status={s.status} small />
          <span style={{ fontSize: 10, color: methodColor(s.match_method), fontWeight: 600, textTransform: 'uppercase', minWidth: 40 }}>
            {methodLabel(s.match_method)}
          </span>
          <span style={{ flex: 1, fontSize: 13, color: '#ddd', whiteSpace: 'pre-wrap' }}>{s.text}</span>
          <span style={{ fontSize: 11, color: '#888' }}>{Math.round(s.similarity * 100)}%</span>
          <button onClick={() => onApply(s.text)} style={{ background: '#1565c0', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 10px', fontSize: 12, cursor: 'pointer' }}>
            Apply
          </button>
        </div>
      ))}
    </div>
  );
}

// ── QA panel ────────────────────────────────────────────────────────────────

const QAPanel = ({ issues }: { issues: QAIssue[] }) => {
  if (issues.length === 0) {
    return <div style={{ color: '#666', fontSize: 13, padding: 8 }}>QA проблем не знайдено</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {issues.map((issue) => (
        <div key={issue.id} style={{ ...s.qaRow, ...(issue.severity === 'error' ? s.qaRowError : s.qaRowWarning) }}>
          <span style={s.qaSeverity}>{issue.severity.toUpperCase()}</span>
          <span style={{ flex: 1, fontSize: 12, color: '#ddd' }}>{issue.message}</span>
        </div>
      ))}
    </div>
  );
}

// ── History panel ───────────────────────────────────────────────────────────

const HistoryPanel = ({ items }: { items: TranslationHistoryEntry[] }) => {
  if (items.length === 0) {
    return <div style={{ color: '#666', fontSize: 13, padding: 8 }}>Історія змін порожня</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((item) => (
        <div key={item.id} style={s.historyRow}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
            <StatusBadge status={item.status} small />
            <span style={{ color: '#888', fontSize: 11 }}>{new Date(item.created_at).toLocaleString()}</span>
            {item.note && <span style={{ color: '#666', fontSize: 11 }}>{item.note}</span>}
          </div>
          <div style={{ color: '#bbb', fontSize: 12, whiteSpace: 'pre-wrap' }}>{item.text ?? '— cleared —'}</div>
        </div>
      ))}
    </div>
  );
}

// ── Search & Replace Modal ───────────────────────────────────────────────────

type SRProps = { modId: number; targetLang: string; onClose: () => void; onApplied: () => void };

const SearchReplaceModal = ({ modId, targetLang, onClose, onApplied }: SRProps) => {
  const [search, setSearch] = useState('');
  const [replace, setReplace] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [previewResult, setPreviewResult] = useState<{ matches: Array<{ originalText: string; newText: string; formid_hex: string }>; applied: number } | null>(null);
  const [stage, setStage] = useState<'idle' | 'previewing' | 'applying' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const handlePreview = async () => {
    if (!search) return;
    setStage('previewing'); setError(null);
    try {
      const r = await api.search.replace(modId, { search, replace, isRegex, targetLang, dryRun: true });
      setPreviewResult(r); setStage('idle');
    } catch (err) { setError(String(err)); setStage('idle'); }
  }

  const handleApply = async () => {
    if (!search) return;
    setStage('applying'); setError(null);
    try {
      const r = await api.search.replace(modId, { search, replace, isRegex, targetLang, dryRun: false });
      setPreviewResult(r); setStage('done'); onApplied();
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
            {previewResult.matches.length > 20 && <p style={{ color: '#888' }}>…ще {previewResult.matches.length - 20}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = {
  root: { display: 'flex', flexDirection: 'column' as const, height: 'calc(100vh - 48px)', overflow: 'hidden', background: '#111', color: '#eee' },
  toolbar: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: '#1a1a1a', borderBottom: '1px solid #2a2a2a', flexWrap: 'wrap' as const, flexShrink: 0 },
  modName: { fontWeight: 700, fontSize: 14, color: '#d4a843', marginRight: 8, whiteSpace: 'nowrap' as const },
  langLabel: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#aaa' },
  langSelect: { background: '#222', color: '#ccc', border: '1px solid #444', borderRadius: 3, padding: '3px 6px', fontSize: 13 } as React.CSSProperties,
  filterSelect: { background: '#222', color: '#ccc', border: '1px solid #444', borderRadius: 3, padding: '4px 7px', fontSize: 13 } as React.CSSProperties,
  searchInput: { background: '#222', color: '#ccc', border: '1px solid #444', borderRadius: 3, padding: '4px 8px', fontSize: 13, width: 200 } as React.CSSProperties,
  sep: { width: 1, height: 24, background: '#333', margin: '0 4px', flexShrink: 0 },
  btnPri: { background: '#1565c0', color: '#fff', border: 'none', borderRadius: 4, padding: '5px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600 } as React.CSSProperties,
  btnSec: { background: '#252525', color: '#ccc', border: '1px solid #3a3a3a', borderRadius: 4, padding: '5px 10px', cursor: 'pointer', fontSize: 12 } as React.CSSProperties,
  btnDanger: { background: '#7b1a1a', color: '#fff', border: 'none', borderRadius: 4, padding: '5px 10px', cursor: 'pointer', fontSize: 12 } as React.CSSProperties,
  btnApprove: { background: '#1b5e20', color: '#fff', border: 'none', borderRadius: 4, padding: '5px 10px', cursor: 'pointer', fontSize: 12 } as React.CSSProperties,
  progressBadge: { background: '#1a3a5c', color: '#7cc8ff', borderRadius: 4, padding: '4px 10px', fontSize: 13 } as React.CSSProperties,
  errorBadge: { color: '#f44', fontSize: 12 },
  qaHint: { display: 'inline-block', marginLeft: 8, padding: '1px 6px', borderRadius: 999, background: '#452300', color: '#ffbf66', fontSize: 10, fontWeight: 700 } as React.CSSProperties,

  body: { display: 'flex', flex: 1, overflow: 'hidden' },

  leftPanel: { width: 160, flexShrink: 0, background: '#141414', borderRight: '1px solid #2a2a2a', overflowY: 'auto' as const, fontSize: 13 },
  sigRow: { display: 'flex', justifyContent: 'space-between', padding: '5px 8px', cursor: 'pointer', borderBottom: '1px solid #1e1e1e', userSelect: 'none' as const },
  sigRowActive: { background: '#333' },
  sigName: { color: '#ccc' },
  sigCount: { color: '#666', fontSize: 11 },

  centerCol: { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },

  tableWrap: { flex: 1, overflowY: 'auto' as const, overflowX: 'auto' as const, position: 'relative' as const },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
  gridHeader: { display: 'flex', position: 'sticky' as const, top: 0, zIndex: 2, background: '#161616' },
  gridRow: { display: 'flex', borderBottom: '1px solid #1c1c1c' },
  th: { textAlign: 'left' as const, color: '#777', fontSize: 10, padding: '5px 6px', borderBottom: '2px solid #2a2a2a', background: '#161616', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em', whiteSpace: 'nowrap' as const, boxSizing: 'border-box' as const },
  tr: { borderBottom: '1px solid #1c1c1c' },
  td: { padding: '5px 6px', verticalAlign: 'top' as const, boxSizing: 'border-box' as const },
  actionBtn: (bg: string) => ({ background: bg, color: '#fff', border: 'none', borderRadius: 3, padding: '1px 6px', cursor: 'pointer', fontSize: 11, fontWeight: 700, minWidth: 20 }) as React.CSSProperties,

  pagination: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, padding: '6px 0', background: '#141414', borderTop: '1px solid #2a2a2a', flexShrink: 0 },
  pageBtn: { background: '#252525', color: '#ccc', border: '1px solid #3a3a3a', borderRadius: 3, padding: '4px 12px', cursor: 'pointer', fontSize: 12 } as React.CSSProperties,

  detailPanel: { background: '#161616', borderTop: '2px solid #2a2a2a', flexShrink: 0 },
  detailPanels: { display: 'flex', gap: 0, borderBottom: '1px solid #2a2a2a' },
  textPanel: { flex: 1, padding: '8px 12px', borderRight: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column' as const, gap: 4 },
  panelLabel: { fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  sourceArea: { background: '#111', color: '#bbb', border: '1px solid #2a2a2a', borderRadius: 3, padding: 6, fontFamily: 'inherit', fontSize: 13, resize: 'none' as const, width: '100%' } as React.CSSProperties,
  translArea: { background: '#0e1a0e', color: '#eee', border: '1px solid #2a4a2a', borderRadius: 3, padding: 6, fontFamily: 'inherit', fontSize: 13, resize: 'none' as const, width: '100%' } as React.CSSProperties,
  charCount: { fontSize: 11, color: '#666', textAlign: 'right' as const },

  tabs: { display: 'flex', gap: 0, background: '#1a1a1a', borderBottom: '1px solid #2a2a2a' },
  tabBtn: { background: 'transparent', color: '#888', border: 'none', borderBottom: '2px solid transparent', padding: '5px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 500 } as React.CSSProperties,
  tabBtnActive: { color: '#eee', borderBottom: '2px solid #1565c0', background: '#1e1e1e' } as React.CSSProperties,
  tabContent: { minHeight: 80, maxHeight: 160, overflowY: 'auto' as const, padding: 8, background: '#141414' },
  qaRow: { display: 'flex', gap: 8, alignItems: 'center', padding: '5px 6px', borderRadius: 4 } as React.CSSProperties,
  qaRowError: { background: '#351515' } as React.CSSProperties,
  qaRowWarning: { background: '#3b2d12' } as React.CSSProperties,
  qaSeverity: { minWidth: 52, fontSize: 10, fontWeight: 700, color: '#fff' } as React.CSSProperties,
  historyRow: { padding: '6px 8px', background: '#1a1a1a', borderRadius: 4 } as React.CSSProperties,

  center: { padding: 32, textAlign: 'center' as const, color: '#888' },
  statusBar: { display: 'flex', alignItems: 'center', padding: '3px 12px', background: '#0d0d0d', borderTop: '1px solid #2a2a2a', fontSize: 11, color: '#ccc', flexShrink: 0 },
};

const modal = {
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  box: { background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, padding: 24, minWidth: 440, maxWidth: 600 },
  input: { background: '#252525', color: '#ccc', border: '1px solid #444', borderRadius: 4, padding: '6px 10px', fontSize: 13, width: '100%' } as React.CSSProperties,
  btn: (bg: string) => ({ background: bg, color: '#fff', border: 'none', borderRadius: 4, padding: '7px 16px', cursor: 'pointer', fontSize: 13 }) as React.CSSProperties,
};
