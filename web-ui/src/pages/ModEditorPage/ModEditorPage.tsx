import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type StringRow } from '../../api';
import { removeAppJob, upsertAppJob } from '../../appJobsQueue';
import { getSrcLang, getTgtLang } from '../../langDefaults';
import { BookEditorModal } from '../../components/BookEditorModal';
import { SearchReplaceModal } from './components/SearchReplaceModal';
import { EditorToolbar } from './components/EditorToolbar';
import { SignaturePanel } from './components/SignaturePanel';
import { StringGrid, type SortCol, type SortDir, type ColumnFilters } from './components/StringGrid';
import { DetailPanel, type BottomTab } from './components/DetailPanel';
import { ContextMenu } from './components/ContextMenu';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { EditorStatusBar } from './components/EditorStatusBar';
import {
  useThemeObserver,
  useEditorQueries,
  useEditorMutations,
  useAutosave,
  useEditorKeyboard,
} from './hooks';
import styles from './ModEditorPage.module.scss';

/** Available status-filter values for the toolbar dropdown. */
const STATUS_OPTS = ['all', 'untranslated', 'draft', 'reviewed', 'rejected', 'fuzzy', 'auto', 'tm', 'human'];
/** Number of string rows displayed per page. */
const PAGE_SIZE = 100;

/**
 * Top-level page component for the mod-editor view.
 *
 * Orchestrates filter / sort / pagination state, delegates data-fetching to
 * {@link useEditorQueries}, persistence to {@link useEditorMutations},
 * autosave to {@link useAutosave}, and keyboard handling to
 * {@link useEditorKeyboard}.  Rendering is delegated to the individual
 * sub-components (EditorToolbar, SignaturePanel, StringGrid, DetailPanel,
 * ContextMenu, ShortcutsOverlay, EditorStatusBar).
 */
export const ModEditorPage = () => {
  const { t } = useTranslation();
  const { id, gameId } = useParams<{ id: string; gameId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const modId = Number(id);
  const qc = useQueryClient();

  const initialStatus = searchParams.get('status');
  const initialQaOnly = searchParams.get('qaOnly') === '1' || searchParams.get('qaOnly') === 'true';
  const safeInitialStatus = initialStatus && STATUS_OPTS.includes(initialStatus) ? initialStatus : 'all';
  const initialSignature = searchParams.get('signature') ?? '';

  // ── Filter / sort / pagination state ──
  const [srcLang, setSrcLang] = useState(getSrcLang());
  const [targetLang, setTargetLang] = useState(getTgtLang());
  const [status, setStatus] = useState(safeInitialStatus);
  const [qaOnly, setQaOnly] = useState(initialQaOnly);
  const [signature, setSignature] = useState(initialSignature);
  const [page, setPage] = useState(1);
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({
    grup: '', formid: '', edid: '', field: '', src: '', transl: '',
  });
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // ── Selection ──
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // ── Active row (detail panel) ──
  const [activeRow, setActiveRow] = useState<StringRow | null>(null);
  const [draftTranslation, setDraftTranslation] = useState('');
  const [activeTab, setActiveTab] = useState<BottomTab>('suggestions');
  const activeRowRef = useRef(activeRow);
  activeRowRef.current = activeRow;
  const translAreaRef = useRef<HTMLTextAreaElement>(null);

  // ── Translate progress ──
  const [translateProgress, setTranslateProgress] = useState<{ done: number; total: number } | null>(null);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [translateDoneCount, setTranslateDoneCount] = useState<number | null>(null);
  const translateInFlight = useRef(false);

  // ── Modal / overlay visibility ──
  const [showSearchReplace, setShowSearchReplace] = useState(false);
  const [showBookEditor, setShowBookEditor] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // ── Context menu ──
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; row: StringRow } | null>(null);

  // ── Custom hooks ──
  useThemeObserver();

  const {
    mod, strings, stats, sigs, suggestions, qaIssues, history,
    isLoading, refetchStats, availLangs, sigCounts, totalPages, activeMaxLength,
  } = useEditorQueries({
    modId, gameId, srcLang, targetLang, status, qaOnly, signature,
    columnFilters, page, pageSize: PAGE_SIZE, sortCol, sortDir,
    activeRow, activeTab,
  });

  const {
    saveMutation, approveMutation, rejectMutation, clearMutation,
    tmApplyMut, bulkReviewMutation, saveIndicator,
  } = useEditorMutations({
    modId, srcLang, targetLang, refetchStats,
    activeRowRef, setActiveRow, setSelected,
  });

  const { flushAutosave, cancelAutosave } = useAutosave({
    activeRow,
    draftTranslation,
    onSave: (stringId, text) => saveMutation.mutate({ stringId, text }),
    onClear: (stringId) => clearMutation.mutate({ stringId }),
  });

  // ── Column-filter / sort handlers ──

  const handleColumnFilterChange = useCallback((col: keyof ColumnFilters, value: string) => {
    setColumnFilters((prev) => ({ ...prev, [col]: value }));
    setPage(1);
  }, []);

  /** Toggles sort direction for a column, or activates sorting on it. */
  const handleSort = useCallback((col: SortCol) => {
    if (sortCol === col) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortCol(null); setSortDir('asc'); }
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
    setPage(1);
  }, [sortCol, sortDir]);

  // ── Sync status / qaOnly to URL search params ──
  useEffect(() => {
    const currentStatus = searchParams.get('status') ?? 'all';
    const currentQaOnly = searchParams.get('qaOnly') === '1' || searchParams.get('qaOnly') === 'true';
    if (currentStatus === status && currentQaOnly === qaOnly) return;
    const next = new URLSearchParams(searchParams);
    if (status !== 'all') next.set('status', status);
    else next.delete('status');
    if (qaOnly) next.set('qaOnly', '1');
    else next.delete('qaOnly');
    setSearchParams(next, { replace: true });
  }, [status, qaOnly, searchParams, setSearchParams]);

  // ── Action helpers ──

  const handleRowClick = useCallback((row: StringRow) => {
    flushAutosave();
    setActiveRow(row);
    setDraftTranslation(row.translation ?? '');
    setActiveTab('suggestions');
  }, [flushAutosave]);

  const handleCopySource = () => {
    if (!activeRow) return;
    setDraftTranslation(activeRow.source);
  };

  const handleSave = () => {
    cancelAutosave();
    if (!activeRow) return;
    if (draftTranslation.trim() === '') { handleClear(activeRow); return; }
    saveMutation.mutate({ stringId: activeRow.string_id, text: draftTranslation });
  };

  const handleApprove = (row: StringRow) => {
    if (!row.translation_id) return;
    approveMutation.mutate({ stringId: row.string_id, translationId: row.translation_id });
  };

  const handleReject = (row: StringRow) => {
    if (!row.translation_id) return;
    rejectMutation.mutate({ stringId: row.string_id, translationId: row.translation_id });
  };

  const handleClear = (row: StringRow) => {
    clearMutation.mutate({ stringId: row.string_id });
    if (activeRow?.string_id === row.string_id) {
      setActiveRow({ ...row, translation: null, translation_id: null, status: null, qa_issue_count: 0 });
      setDraftTranslation('');
    }
  };

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
  };

  const handleBatchTranslate = async () => {
    if (translateInFlight.current) return;
    translateInFlight.current = true;
    setTranslateError(null);
    setTranslateDoneCount(null);
    setTranslateProgress({ done: 0, total: selected.size });
    const appJobId = `llm-${modId}-${Date.now()}`;
    const startedAt = Date.now();
    const appJobLabel = `LLM batch translate · mod ${modId}`;
    upsertAppJob({
      id: appJobId,
      kind: 'llm',
      label: appJobLabel,
      status: 'running',
      progress: 0,
      createdAt: startedAt,
      updatedAt: startedAt,
    });

    try {
      const results = await api.strings.batchTranslate([...selected], srcLang, targetLang, (e) => {
        const progress = e.total > 0 ? Math.round((e.done / e.total) * 100) : 0;
        upsertAppJob({
          id: appJobId,
          kind: 'llm',
          label: appJobLabel,
          status: 'running',
          progress,
          createdAt: startedAt,
          updatedAt: Date.now(),
        });
      }, modId);
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      void refetchStats();
      const doneCount = results.filter((r) => r.text !== undefined).length;
      setTranslateDoneCount(doneCount);
      setSelected(new Set());
      upsertAppJob({
        id: appJobId,
        kind: 'llm',
        label: appJobLabel,
        status: 'completed',
        progress: 100,
        createdAt: startedAt,
        updatedAt: Date.now(),
      });
      setTimeout(() => removeAppJob(appJobId), 15_000);
    } catch (err) {
      setTranslateError(String(err));
      upsertAppJob({
        id: appJobId,
        kind: 'llm',
        label: appJobLabel,
        status: 'failed',
        progress: null,
        error: String(err),
        createdAt: startedAt,
        updatedAt: Date.now(),
      });
    } finally {
      setTranslateProgress(null);
      translateInFlight.current = false;
    }
  };

  // ── Context menu helpers ──

  const handleContextMenu = useCallback((e: React.MouseEvent, row: StringRow) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, row });
  }, []);

  const applyTextTransform = useCallback(async (row: StringRow, transform: (text: string) => string) => {
    const targetRows = (selected.size > 1 && selected.has(row.string_id))
      ? strings?.rows.filter((r) => selected.has(r.string_id) && r.translation) ?? []
      : row.translation ? [row] : [];
    for (const r of targetRows) {
      const newText = transform(r.translation!);
      if (newText !== r.translation) await api.strings.saveTranslation(r.string_id, newText, 'draft', targetLang);
    }
    qc.invalidateQueries({ queryKey: ['strings', modId] });
    void refetchStats();
  }, [selected, strings, targetLang, qc, modId, refetchStats]);

  const ctxCopySource = useCallback(async (row: StringRow) => {
    const targetRows = (selected.size > 1 && selected.has(row.string_id))
      ? strings?.rows.filter((r) => selected.has(r.string_id)) ?? []
      : [row];
    for (const r of targetRows) {
      await api.strings.saveTranslation(r.string_id, r.source, 'draft', targetLang);
    }
    qc.invalidateQueries({ queryKey: ['strings', modId] });
    void refetchStats();
  }, [selected, strings, targetLang, qc, modId, refetchStats]);

  // ── Keyboard shortcuts ──
  useEditorKeyboard({
    activeRow, selected, strings, ctxMenu, page,
    pageSize: PAGE_SIZE, translAreaRef,
    flushAutosave, handleSave, handleApprove, handleReject,
    handleCopySource, handleClear, handleRowClick, toggleAll,
    setActiveRow, setDraftTranslation, setSelected,
    setCtxMenu, setPage, setShowShortcuts,
  });

  /** Programmatic "next untranslated" navigation — mirrors the `n` key shortcut. */
  const handleNextUntranslated = useCallback(() => {
    if (!strings?.rows.length) return;
    const rows = strings.rows;
    const curIdx = activeRow
      ? rows.findIndex((r) => r.string_id === activeRow.string_id)
      : -1;
    for (let i = 1; i <= rows.length; i++) {
      const idx = (curIdx + i) % rows.length;
      if (!rows[idx].translation) {
        handleRowClick(rows[idx]);
        break;
      }
    }
  }, [strings, activeRow, handleRowClick]);

  // ── Render ──
  return (
    <div className={styles.root}>
      <EditorToolbar
        modName={mod?.name}
        srcLang={srcLang}
        targetLang={targetLang}
        availLangs={availLangs}
        status={status}
        qaOnly={qaOnly}
        stats={stats}
        selectedCount={selected.size}
        translateProgress={translateProgress}
        translateError={translateError}
        tmApply={{
          isPending: tmApplyMut.isPending,
          isSuccess: tmApplyMut.isSuccess,
          applied: (tmApplyMut.data as { applied: number } | undefined)?.applied ?? 0,
        }}
        bulkReviewPending={bulkReviewMutation.isPending}
        gameId={gameId}
        modId={modId}
        hasInnrSignature={!!sigs?.some((s: { signature: string }) => s.signature === 'INNR')}
        hasBookSignature={!!sigs?.some((s: { signature: string }) => s.signature === 'BOOK')}
        untranslatedCount={stats?.untranslated}
        statusOpts={STATUS_OPTS}
        onSrcLangChange={(l) => { setSrcLang(l); setPage(1); }}
        onTargetLangChange={(l) => { setTargetLang(l); setPage(1); }}
        onStatusChange={(s) => { setStatus(s); setPage(1); }}
        onQaOnlyToggle={() => { setQaOnly((v) => !v); setPage(1); }}
        onTmApply={() => tmApplyMut.mutate()}
        onSearchReplace={() => setShowSearchReplace(true)}
        onShortcuts={() => setShowShortcuts((v) => !v)}
        onBatchTranslate={handleBatchTranslate}
        onBulkReview={(s) => bulkReviewMutation.mutate({ ids: [...selected], status: s })}
        onNextUntranslated={handleNextUntranslated}
      />

      {/* Post-LLM-run action banner — shown after a successful batch translate */}
      {translateDoneCount !== null && (
        <div className={styles.translateBanner}>
          <span>{t('modEditor.translateDone', { count: translateDoneCount })}</span>
          <Link to={`/review-queue?modId=${modId}`} className={styles.translateBannerLink}>
            {t('modEditor.openReviewQueue')}
          </Link>
          <button
            className={styles.translateBannerDismiss}
            onClick={() => setTranslateDoneCount(null)}
            aria-label={t('common.dismiss')}
          >
            ×
          </button>
        </div>
      )}

      {/* ── 3-column body ── */}
      <div className={styles.body}>
        <SignaturePanel
          sigCounts={sigCounts}
          activeSignature={signature}
          totalFiltered={strings?.total}
          onSelect={(sig) => { setSignature(sig); setPage(1); }}
        />

        <div className={styles.centerCol}>
          <StringGrid
            rows={strings?.rows ?? []}
            total={strings?.total ?? 0}
            isLoading={isLoading}
            selected={selected}
            activeRow={activeRow}
            srcLang={srcLang}
            targetLang={targetLang}
            sortCol={sortCol}
            sortDir={sortDir}
            columnFilters={columnFilters}
            onRowClick={handleRowClick}
            onToggleRow={toggleRow}
            onToggleAll={toggleAll}
            onSort={handleSort}
            onColumnFilterChange={handleColumnFilterChange}
            onContextMenu={handleContextMenu}
            onApprove={handleApprove}
            onReject={handleReject}
            onClear={handleClear}
            onCopySource={(row) => { handleRowClick(row); setTimeout(() => setDraftTranslation(row.source), 0); }}
          />

          {/* Pagination */}
          <div className={styles.pagination}>
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className={styles.pageBtn}>{t('common.prev')}</button>
            <span className={styles.pageLabel}>{t('modEditor.pageInfo', { page, totalPages, total: strings?.total ?? 0 })}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className={styles.pageBtn}>{t('common.next')}</button>
          </div>

          {activeRow && (
            <DetailPanel
              activeRow={activeRow}
              draftTranslation={draftTranslation}
              srcLang={srcLang}
              targetLang={targetLang}
              activeTab={activeTab}
              saveIndicator={saveIndicator}
              savePending={saveMutation.isPending}
              activeMaxLength={activeMaxLength}
              suggestions={suggestions ?? []}
              qaIssues={qaIssues ?? []}
              history={history ?? []}
              translAreaRef={translAreaRef}
              onDraftChange={setDraftTranslation}
              onSave={handleSave}
              onCopySource={handleCopySource}
              onApprove={() => handleApprove(activeRow)}
              onReject={() => handleReject(activeRow)}
              onTabChange={setActiveTab}
              onOpenBookEditor={() => setShowBookEditor(true)}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      {showSearchReplace && (
        <SearchReplaceModal modId={modId} targetLang={targetLang} onClose={() => setShowSearchReplace(false)} onApplied={() => { qc.invalidateQueries({ queryKey: ['strings', modId] }); }} />
      )}
      {showBookEditor && activeRow && (
        <BookEditorModal
          source={activeRow.source}
          translation={draftTranslation}
          onSave={(markup) => { setDraftTranslation(markup); setShowBookEditor(false); }}
          onClose={() => setShowBookEditor(false)}
        />
      )}
      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          anchor={ctxMenu}
          selected={selected}
          rows={strings?.rows ?? []}
          targetLang={targetLang}
          bulkReviewPending={bulkReviewMutation.isPending}
          onClose={() => setCtxMenu(null)}
          onApprove={handleApprove}
          onReject={handleReject}
          onClear={handleClear}
          onCopySource={(row) => { handleRowClick(row); setTimeout(() => setDraftTranslation(row.source), 0); }}
          onTextTransform={applyTextTransform}
          onBulkCopySource={ctxCopySource}
          onBulkReview={(s) => bulkReviewMutation.mutate({ ids: [...selected], status: s })}
          onBatchTranslate={handleBatchTranslate}
        />
      )}

      <EditorStatusBar selectedCount={selected.size} activeRow={activeRow} stats={stats} />
    </div>
  );
};


