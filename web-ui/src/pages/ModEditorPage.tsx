import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { api, type QAIssue, type StringRow, type TMSuggestion, type TranslationHistoryEntry } from '../api';
import { StatusBadge, ProgressBar } from '../components/StatusBadge';
import styles from './ModEditorPage.module.scss';

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
  const { t } = useTranslation();
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

  // Virtualizer (must be after `strings` declaration)
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: strings?.rows.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 36,
    overscan: 10,
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

  /** Downloads a full project ZIP (BA2 + patched ESP) as a single file */
  const exportProject = useMutation({
    mutationFn: () => api.mods.exportProject(modId, srcLang, targetLang),
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
    <div className={styles.root}>
      {/* ── Top toolbar ── */}
      <div className={styles.toolbar}>
        <span className={styles.modName}>{mod?.name ?? '…'}</span>

        {/* Lang selectors */}
        <label className={styles.langLabel}>
          {t('modEditor.source')}
          <select value={srcLang} onChange={(e) => { setSrcLang(e.target.value); setPage(1); }} className={styles.langSelect}>
            {availLangs.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </label>
        <label className={styles.langLabel}>
          {t('modEditor.target')}
          <select value={targetLang} onChange={(e) => { setTargetLang(e.target.value); setPage(1); }} className={styles.langSelect}>
            {availLangs.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </label>

        <div className={styles.sep} />

        {/* Status filter */}
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={styles.filterSelect}>
          {STATUS_OPTS.map((o) => <option key={o} value={o}>{o === 'all' ? t('modEditor.allStatuses') : o}</option>)}
        </select>
        <button
          onClick={() => { setStatus(status === 'draft' ? 'all' : 'draft'); setPage(1); }}
          className={status === 'draft' ? styles.btnPri : styles.btnSec}
          title={t('modEditor.showDraftsTitle')}
        >
          {stats?.draft ? t('modEditor.reviewModeCount', { count: stats.draft }) : t('modEditor.reviewMode')}
        </button>

        {/* Search */}
        <input placeholder={t('modEditor.searchPlaceholder')} value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} className={styles.searchInput} />

        <div className={styles.sep} />

        {/* Actions */}
        <button onClick={() => tmApply.mutate()} disabled={tmApply.isPending} className={styles.btnSec} title={t('modEditor.autoFillTmTitle')}>
          {tmApply.isPending ? t('modEditor.applyingTm') : tmApply.isSuccess ? t('modEditor.tmApplied', { count: (tmApply.data as { applied: number }).applied }) : t('modEditor.applyTm')}
        </button>
        <button onClick={() => exportStrings.mutate()} disabled={exportStrings.isPending} className={styles.btnSec} title={t('modEditor.exportStringsTitle')}>
          {exportStrings.isPending ? t('modEditor.exporting') : t('modEditor.exportStrings')}
        </button>
        <button onClick={() => exportEsp.mutate()} disabled={exportEsp.isPending} className={styles.btnSec} title={t('modEditor.exportEspTitle')}>
          {exportEsp.isPending ? t('modEditor.exporting') : t('modEditor.exportEsp')}
        </button>
        <button onClick={() => exportBa2.mutate()} disabled={exportBa2.isPending} className={styles.btnSec} title={t('modEditor.exportBa2Title')}>
          {exportBa2.isPending ? t('modEditor.exporting') : t('modEditor.exportBa2')}
        </button>
        <button onClick={() => exportProject.mutate()} disabled={exportProject.isPending} className={styles.btnPri} title={t('modEditor.exportZipTitle')}>
          {exportProject.isPending ? t('modEditor.exporting') : t('modEditor.exportZip')}
        </button>
        <button onClick={() => setShowSearchReplace(true)} className={styles.btnSec}>{t('modEditor.searchReplace')}</button>
        {selected.size > 0 && (
          <>
            {translateProgress
              ? <span className={styles.progressBadge}>{t('modEditor.translating', { done: translateProgress.done, total: translateProgress.total })}</span>
              : <button onClick={handleBatchTranslate} className={styles.btnPri}>{t('modEditor.autoTranslate', { count: selected.size })}</button>
            }
            <button
              onClick={() => bulkReviewMutation.mutate({ status: 'reviewed' })}
              disabled={bulkReviewMutation.isPending}
              className={styles.btnApprove}
              title={t('modEditor.confirm')}
            >
              {bulkReviewMutation.isPending ? '…' : t('modEditor.approveCount', { count: selected.size })}
            </button>
            <button
              onClick={() => bulkReviewMutation.mutate({ status: 'rejected' })}
              disabled={bulkReviewMutation.isPending}
              className={styles.btnDanger}
              title={t('modEditor.reject')}
            >
              {bulkReviewMutation.isPending ? '…' : t('modEditor.rejectCount', { count: selected.size })}
            </button>
          </>
        )}
        {translateError && <span className={styles.errorBadge}>{translateError}</span>}
        {exportStrings.isError && <span className={styles.errorBadge}>{String(exportStrings.error)}</span>}
        {exportEsp.isError && <span className={styles.errorBadge}>{String(exportEsp.error)}</span>}
        {exportBa2.isError && <span className={styles.errorBadge}>{String(exportBa2.error)}</span>}

        {/* Progress bar */}
        {stats && (
          <div className={styles.progressSection}>
            <ProgressBar stats={stats} />
            <span className={styles.progressLabel}>
              {t('modEditor.approvedOfTotal', { approved: stats.approved, total: stats.total })}
            </span>
          </div>
        )}
      </div>

      {/* ── 3-column body ── */}
      <div className={styles.body}>

        {/* LEFT: signature tree */}
        <div className={styles.leftPanel}>
          <div
            className={`${styles.sigRow} ${signature === '' ? styles.sigRowActive : ''}`}
            onClick={() => { setSignature(''); setPage(1); }}
          >
            <span className={styles.sigName}>{t('modEditor.allSigs')}</span>
            <span className={styles.sigCount}>{strings?.total ?? '…'} / {sigCounts.reduce((a, r) => a + Number(r.count), 0)}</span>
          </div>
          {sigCounts.map((sig) => (
            <div
              key={sig.signature}
              className={`${styles.sigRow} ${signature === sig.signature ? styles.sigRowActive : ''}`}
              onClick={() => { setSignature(sig.signature); setPage(1); }}
            >
              <span className={styles.sigName}>{sig.signature}</span>
              <span className={styles.sigCount}>{sig.count}</span>
            </div>
          ))}
        </div>

        {/* CENTER+RIGHT: table + detail panel */}
        <div className={styles.centerCol}>

          {/* ── String table (virtualized) ── */}
          <div className={styles.tableWrap} ref={scrollRef}>
            {isLoading ? (
              <div className={styles.center}>{t('common.loading')}</div>
            ) : (
              <>
                {/* Sticky header */}
                <div className={styles.gridHeader}>
                  <div className={`${styles.th} ${styles.colCheck}`}>
                    <input type="checkbox" checked={!!strings?.rows.length && selected.size === strings.rows.length} onChange={toggleAll} />
                  </div>
                  <div className={`${styles.th} ${styles.colGrup}`}>{t('modEditor.grup')}</div>
                  <div className={`${styles.th} ${styles.colFormId}`}>{t('modEditor.formId')}</div>
                  <div className={`${styles.th} ${styles.colEdid}`}>{t('modEditor.edid')}</div>
                  <div className={`${styles.th} ${styles.colField}`}>{t('modEditor.field')}</div>
                  <div className={`${styles.th} ${styles.colText}`}>{t('modEditor.sourceText', { lang: srcLang.toUpperCase() })}</div>
                  <div className={`${styles.th} ${styles.colText}`}>{t('modEditor.translationText', { lang: targetLang.toUpperCase() })}</div>
                  <div className={`${styles.th} ${styles.colAct}`}>{t('modEditor.actions')}</div>
                </div>
                {/* Virtualized rows */}
                <div className={styles.virtualScroll} style={{ height: rowVirtualizer.getTotalSize() }}>
                  {rowVirtualizer.getVirtualItems().map((vItem) => {
                    const row = strings!.rows[vItem.index];
                    const isActive = activeRow?.string_id === row.string_id;
                    return (
                      <div
                        key={row.string_id}
                        data-index={vItem.index}
                        ref={rowVirtualizer.measureElement}
                        className={`${styles.gridRow} ${styles.virtualRow}`}
                        style={{
                          transform: `translateY(${vItem.start}px)`,
                          background: rowBg(isActive ? '__active' : row.status),
                          outline: isActive ? '1px solid #aaa' : 'none',
                        }}
                        onClick={() => handleRowClick(row)}
                      >
                        <div className={`${styles.td} ${styles.colCheck}`} onClick={(e) => toggleRow(row, e)}>
                          <input type="checkbox" checked={selected.has(row.string_id)} onChange={() => {}} />
                        </div>
                        <div className={`${styles.tdSig} ${styles.colGrup}`}>{row.signature}</div>
                        <div className={`${styles.tdFid} ${styles.colFormId}`}>{row.formid_hex}</div>
                        <div className={`${styles.tdEdidCell} ${styles.colEdid}`} title={row.edid ?? ''}>{row.edid ?? ''}</div>
                        <div className={`${styles.tdField} ${styles.colField}`}>{row.path?.split('.').pop() ?? ''}</div>
                        <div className={styles.tdText}>{row.source}</div>
                        <div className={row.translation ? styles.tdTranslFilled : styles.tdTranslEmpty}>
                          {row.translation ?? '—'}
                          {row.qa_issue_count > 0 && (
                            <span className={styles.qaHint}>{row.qa_issue_count} QA</span>
                          )}
                        </div>
                        <div className={`${styles.td} ${styles.colAct}`} onClick={(e) => e.stopPropagation()}>
                          <div className={styles.actionBtnRow}>
                            {row.translation && row.status !== 'reviewed' && row.status !== 'human' && row.translation_id && (
                              <button className={styles.actionBtnBlue} title={t('modEditor.confirm')} onClick={() => handleApprove(row)}>V</button>
                            )}
                            {row.translation && row.status !== 'rejected' && row.translation_id && (
                              <button className={styles.actionBtnRed} title={t('modEditor.reject')} onClick={() => rejectMutation.mutate({ stringId: row.string_id, translationId: row.translation_id! })}>R</button>
                            )}
                            <button className={styles.actionBtnRed} title={t('modEditor.clearTranslation')} onClick={() => handleClear(row)}>X</button>
                            <button className={styles.actionBtnGreen} title={t('modEditor.copySourceToTranslation')} onClick={() => { handleRowClick(row); setTimeout(() => setDraftTranslation(row.source), 0); }}>C</button>
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
          <div className={styles.pagination}>
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className={styles.pageBtn}>{t('common.prev')}</button>
            <span className={styles.pageLabel}>{t('modEditor.pageInfo', { page, totalPages, total: strings?.total ?? 0 })}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className={styles.pageBtn}>{t('common.next')}</button>
          </div>

          {/* ── Detail edit panel ── */}
          {activeRow && (
            <div className={styles.detailPanel}>
              <div className={styles.detailPanels}>
                {/* Source */}
                <div className={styles.textPanel}>
                  <div className={styles.panelLabel}>{t('modEditor.sourceTextLabel', { lang: srcLang.toUpperCase() })}</div>
                  <textarea readOnly value={activeRow.source} className={styles.sourceArea} rows={4} />
                  <div className={styles.charCount}>{t('modEditor.charCount', { count: activeRow.source.length })}</div>
                </div>
                {/* Translation */}
                <div className={styles.textPanel}>
                  <div className={styles.panelLabel}>{t('modEditor.translationTextLabel', { lang: targetLang.toUpperCase() })}</div>
                  <textarea
                    value={draftTranslation}
                    onChange={(e) => setDraftTranslation(e.target.value)}
                    className={styles.translArea}
                    rows={4}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSave(); }}
                    placeholder={t('modEditor.enterTranslation')}
                  />
                  <div className={styles.detailBtnBar}>
                    <div className={styles.charCount}>{t('modEditor.charCount', { count: draftTranslation.length })}</div>
                    <div className={styles.detailSaveRow}>
                      <button className={styles.btnSec} onClick={handleCopySource} title={t('modEditor.copySourceToTranslation')}>{t('modEditor.copySrc')}</button>
                      {activeRow.translation && activeRow.translation_id && activeRow.status !== 'reviewed' && activeRow.status !== 'human' && (
                        <button className={styles.btnSec} onClick={() => handleApprove(activeRow)}>
                          {t('modEditor.review')}
                        </button>
                      )}
                      {activeRow.translation && activeRow.translation_id && activeRow.status !== 'rejected' && (
                        <button className={styles.btnDanger} onClick={() => rejectMutation.mutate({ stringId: activeRow.string_id, translationId: activeRow.translation_id! })}>
                          {t('modEditor.reject')}
                        </button>
                      )}
                      <button
                        className={styles.btnPri}
                        onClick={handleSave}
                        disabled={saveMutation.isPending}
                        title="Ctrl+Enter"
                      >
                        {saveMutation.isPending ? t('modEditor.saving') : saveIndicator === 'saved' ? t('modEditor.saved') : t('common.save')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom tabs */}
              <div className={styles.tabs}>
                {(['suggestions', 'qa', 'history'] as BottomTab[]).map((tab) => (
                  <button key={tab} className={`${styles.tabBtn} ${activeTab === tab ? styles.tabBtnActive : ''}`} onClick={() => setActiveTab(tab)}>
                    {tab === 'suggestions' ? t('modEditor.tabSuggestions') : tab === 'qa' ? t('modEditor.tabQa') : t('modEditor.tabHistory')}
                  </button>
                ))}
              </div>
              <div className={styles.tabContent}>
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
      <div className={styles.statusBar}>
        <span>{t('modEditor.selectedRows', { count: selected.size })}</span>
        {activeRow && (
          <span className={styles.statusBarDetail}>
            {activeRow.signature} · {activeRow.formid_hex} · {activeRow.edid ?? '—'}
          </span>
        )}
        {stats && (
          <span className={styles.statusBarStats}>
            {t('status.approved')}: {stats.approved} · {t('status.draft')}: {stats.draft} · {t('status.rejected')}: {stats.rejected} · {t('status.tm')}: {stats.tm} · {t('status.fuzzy')}: {stats.fuzzy} · {t('status.auto')}: {stats.auto_translated} · {t('status.untranslated')}: {stats.untranslated} · {t('status.total')}: {stats.total}
          </span>
        )}
      </div>
    </div>
  );
}

// ── TM Suggestions panel ─────────────────────────────────────────────────────

const SuggestionsPanel = ({ suggestions, onApply }: { suggestions: TMSuggestion[]; onApply: (text: string) => void }) => {
  const { t } = useTranslation();
  if (suggestions.length === 0) {
    return <div className={styles.panelEmpty}>{t('modEditor.noSuggestions')}</div>;
  }
  const methodLabel = (m: string) => m === 'exact' ? t('modEditor.exact') : m === 'punct_norm' ? t('modEditor.punct') : m === 'segment' ? t('modEditor.phrase') : t('modEditor.fuzzyMethod');
  const methodColor = (m: string) => m === 'exact' ? '#4caf50' : m === 'punct_norm' ? '#ff9800' : m === 'segment' ? '#ab47bc' : '#2196f3';
  return (
    <div className={styles.panelListGap4}>
      {suggestions.map((s) => (
        <div key={s.id} className={styles.suggestionRow}>
          <StatusBadge status={s.status} small />
          <span className={styles.suggMethod} style={{ '--sugg-color': methodColor(s.match_method) } as React.CSSProperties}>
            {methodLabel(s.match_method)}
          </span>
          <span className={styles.suggText}>{s.text}</span>
          <span className={styles.suggSim}>{Math.round(s.similarity * 100)}%</span>
          <button onClick={() => onApply(s.text)} className={styles.suggestionApplyBtn}>
            {t('common.apply')}
          </button>
        </div>
      ))}
    </div>
  );
}

// ── QA panel ────────────────────────────────────────────────────────────────

const QAPanel = ({ issues }: { issues: QAIssue[] }) => {
  const { t } = useTranslation();
  if (issues.length === 0) {
    return <div className={styles.panelEmpty}>{t('modEditor.noQaIssues')}</div>;
  }
  return (
    <div className={styles.panelListGap2}>
      {issues.map((issue) => (
        <div key={issue.id} className={`${styles.qaRow} ${issue.severity === 'error' ? styles.qaRowError : styles.qaRowWarning}`}>
          <span className={styles.qaSeverity}>{issue.severity.toUpperCase()}</span>
          <span className={styles.qaMsg}>{issue.message}</span>
        </div>
      ))}
    </div>
  );
}

// ── History panel ───────────────────────────────────────────────────────────

const HistoryPanel = ({ items }: { items: TranslationHistoryEntry[] }) => {
  const { t } = useTranslation();
  if (items.length === 0) {
    return <div className={styles.panelEmpty}>{t('modEditor.emptyHistory')}</div>;
  }
  return (
    <div className={styles.panelListGap4}>
      {items.map((item) => (
        <div key={item.id} className={styles.historyRow}>
          <div className={styles.histHeader}>
            <StatusBadge status={item.status} small />
            <span className={styles.histDate}>{new Date(item.created_at).toLocaleString()}</span>
            {item.note && <span className={styles.histNote}>{item.note}</span>}
          </div>
          <div className={styles.histText}>{item.text ?? t('modEditor.cleared')}</div>
        </div>
      ))}
    </div>
  );
}

// ── Search & Replace Modal ───────────────────────────────────────────────────

type SRProps = { modId: number; targetLang: string; onClose: () => void; onApplied: () => void };

const SearchReplaceModal = ({ modId, targetLang, onClose, onApplied }: SRProps) => {
  const { t } = useTranslation();
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
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.modalTitle}>{t('modEditor.searchReplaceTitle')}</h3>
        <div className={styles.modalForm}>
          <input placeholder={t('modEditor.searchLabel')} value={search} onChange={(e) => setSearch(e.target.value)} className={styles.modalInput} />
          <input placeholder={t('modEditor.replaceLabel')} value={replace} onChange={(e) => setReplace(e.target.value)} className={styles.modalInput} />
          <label className={styles.modalRegexLbl}>
            <input type="checkbox" checked={isRegex} onChange={(e) => setIsRegex(e.target.checked)} /> {t('modEditor.useRegex')}
          </label>
        </div>
        <div className={styles.modalBtnRow}>
          <button onClick={handlePreview} disabled={stage !== 'idle' || !search} className={styles.modalBtnDark}>{t('modEditor.preview', { count: previewResult?.matches.length ?? 0 })}</button>
          <button onClick={handleApply} disabled={stage !== 'idle' || !search} className={styles.modalBtnPri}>{t('common.apply')}</button>
          <button onClick={onClose} className={styles.modalBtnSec}>{t('common.cancel')}</button>
        </div>
        {error && <p className={styles.modalErr}>{error}</p>}
        {stage === 'done' && <p className={styles.modalOk}>{t('modEditor.applied', { count: previewResult?.applied })}</p>}
        {previewResult && stage !== 'done' && previewResult.matches.length > 0 && (
          <div className={styles.modalPreview}>
            {previewResult.matches.slice(0, 20).map((m, i) => (
              <div key={i} className={styles.modalPrevItem}>
                <span className={styles.modalPrevId}>{m.formid_hex}</span>
                <span className={styles.modalPrevOld}>{m.originalText.slice(0, 60)}</span>
                {' → '}
                <span className={styles.modalPrevNew}>{m.newText.slice(0, 60)}</span>
              </div>
            ))}
            {previewResult.matches.length > 20 && <p className={styles.modalPrevMore}>{t('modEditor.more', { count: previewResult.matches.length - 20 })}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

// Styles are in ModEditorPage.module.scss
// Styles are in ModEditorPage.module.scss (modal section)
