import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type StringRow, type StringFilterParams, type StringsResult } from '../../api';
import { removeAppJob, upsertAppJob } from '../../appJobsQueue';
import { getSrcLang, getTgtLang } from '../../langDefaults';
import { BookEditorModal } from '../../components/BookEditorModal';
import { SearchReplaceModal } from './components/SearchReplaceModal';
import { ApplyTranslationFromModModal } from './components/ApplyTranslationFromModModal';
import { AiVerifyModal } from './components/AiVerifyModal';
import { AiTranslateModal } from './components/AiTranslateModal';
import { SkipTranslateModal } from './components/SkipTranslateModal';
import { EditorToolbar } from './components/EditorToolbar';
import { DialogsMode } from './components/DialogsMode';
import { SignaturePanel } from './components/SignaturePanel';
import {
  StringGrid,
  type SortCol,
  type SortDir,
  type ColumnFilters,
} from './components/StringGrid';
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
  useAiVerify,
  useAiTranslate,
  useSkipDetect,
  useApplyImported,
} from './hooks';
import { parseStatusParam, statusParamFromSelection, type StatusFilterValue } from './statusFilter';
import styles from './ModEditorPage.module.scss';

/** Rows fetched per infinite-scroll page (the grid accumulates pages). */
const FETCH_PAGE_SIZE = 100;

/**
 * Top-level page component for the mod-editor view.
 *
 * Orchestrates filter / sort / selection state, delegates data-fetching to
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

  /** localStorage key scoped to this mod — persists the last-used filter intent. */
  const storageKey = `editor-intent-${modId}`;
  const storedIntent = (() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? 'null') as {
        statuses?: string[];
        status?: string;
        qaOnly?: boolean;
        signature?: string;
      } | null;
    } catch {
      return null;
    }
  })();

  // URL params take priority; localStorage provides the fallback when params are absent
  const initialStatusParam = searchParams.get('status');
  const initialQaOnly = searchParams.get('qaOnly') === '1' || searchParams.get('qaOnly') === 'true';
  const safeInitialStatuses = (() => {
    const fromUrl = parseStatusParam(initialStatusParam);
    if (fromUrl.length > 0) return fromUrl;
    if (storedIntent?.statuses?.length) {
      return parseStatusParam(storedIntent.statuses.join(','));
    }
    if (storedIntent?.status) {
      return parseStatusParam(storedIntent.status);
    }
    return [];
  })();
  const resolvedQaOnly = searchParams.has('qaOnly')
    ? initialQaOnly
    : (storedIntent?.qaOnly ?? false);
  const initialSignature = searchParams.get('signature') ?? storedIntent?.signature ?? '';

  // ── Filter / sort state ──
  const [srcLang, setSrcLang] = useState(getSrcLang());
  const [targetLang, setTargetLang] = useState(getTgtLang());
  const [selectedStatuses, setSelectedStatuses] =
    useState<StatusFilterValue[]>(safeInitialStatuses);
  const [qaOnly, setQaOnly] = useState(resolvedQaOnly);
  const [signature, setSignature] = useState(initialSignature);
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({
    grup: '',
    formid: '',
    edid: '',
    field: '',
    src: '',
    transl: '',
  });
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // ── Page mode: strings grid or dialogs tree ──
  const [pageMode, setPageMode] = useState<'strings' | 'dialogs'>('strings');

  // Persist the active filter intent per mod so it is restored on the next visit
  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ statuses: selectedStatuses, qaOnly, signature }),
      );
    } catch {
      // Ignore quota / private-browsing errors
    }
  }, [selectedStatuses, qaOnly, signature, storageKey]);

  // ── Selection ──
  //
  // Two modes:
  //   • explicit ("some")  — `selected` holds the explicitly included IDs.
  //   • "all matching"     — `selectAllMatching` is true and `selected` instead
  //                          holds the IDs the user explicitly DE-selected.
  // This lets the header checkbox select every row matching the current filter
  // (potentially thousands) without ever materialising that ID list client-side.
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // ── Active row (detail panel) ──
  const [activeRow, setActiveRow] = useState<StringRow | null>(null);
  const [focusedRow, setFocusedRow] = useState<StringRow | null>(null);
  const [draftTranslation, setDraftTranslation] = useState('');
  const [activeTab, setActiveTab] = useState<BottomTab>('suggestions');
  const activeRowRef = useRef(activeRow);
  activeRowRef.current = activeRow;
  const translAreaRef = useRef<HTMLTextAreaElement>(null);

  // ── Translate progress ──
  const [translateProgress, setTranslateProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [translateDoneCount, setTranslateDoneCount] = useState<number | null>(null);
  const translateInFlight = useRef(false);

  // ── Modal / overlay visibility ──
  const [showSearchReplace, setShowSearchReplace] = useState(false);
  const [showApplyTranslationFromMod, setShowApplyTranslationFromMod] = useState(false);
  const [showAiVerify, setShowAiVerify] = useState(false);
  const [showAiTranslate, setShowAiTranslate] = useState(false);
  const [showSkipDetect, setShowSkipDetect] = useState(false);
  const [showBookEditor, setShowBookEditor] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // ── Context menu ──
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; row: StringRow } | null>(null);

  // ── Custom hooks ──
  useThemeObserver();

  const {
    mod,
    strings,
    stats,
    sigs,
    suggestions,
    qaIssues,
    history,
    isLoading,
    refetchStats,
    availLangs,
    sigCounts,
    activeMaxLength,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useEditorQueries({
    modId,
    gameId,
    srcLang,
    targetLang,
    selectedStatuses,
    qaOnly,
    signature,
    columnFilters,
    pageSize: FETCH_PAGE_SIZE,
    sortCol,
    sortDir,
    activeRow,
    activeTab,
  });

  // ── Derived selection state ──
  const total = strings?.total ?? 0;
  /** True when `id` is currently selected, honouring the active selection mode. */
  const isRowSelected = useCallback(
    (id: number) => (selectAllMatching ? !selected.has(id) : selected.has(id)),
    [selectAllMatching, selected],
  );
  /** Number of selected rows (across the whole filtered set in "all" mode). */
  const selectedCount = selectAllMatching ? Math.max(0, total - selected.size) : selected.size;
  const hasSelection = selectedCount > 0;
  /** Header checkbox is fully checked only when every matching row is selected. */
  const allSelected = selectAllMatching && selected.size === 0 && total > 0;
  /** Header checkbox shows the indeterminate state for a partial selection. */
  const someSelected = hasSelection && !allSelected;

  /** Clears the selection and exits "all matching" mode. */
  const clearSelection = useCallback(() => {
    setSelectAllMatching(false);
    setSelected(new Set());
  }, []);

  /** Builds the server filter payload mirroring the current grid query. */
  const buildFilter = useCallback(
    (): StringFilterParams => ({
      srcLang,
      targetLang,
      status: statusParamFromSelection(selectedStatuses),
      qaOnly: qaOnly || undefined,
      signature: signature || undefined,
      grup: columnFilters.grup || undefined,
      formid: columnFilters.formid || undefined,
      edid: columnFilters.edid || undefined,
      field: columnFilters.field || undefined,
      src: columnFilters.src || undefined,
      transl: columnFilters.transl || undefined,
    }),
    [srcLang, targetLang, selectedStatuses, qaOnly, signature, columnFilters],
  );

  /** Loaded rows that are currently selected (bounded by what's in memory). */
  const selectedLoadedRows = useCallback(
    () => (strings?.rows ?? []).filter((r) => isRowSelected(r.string_id)),
    [strings, isRowSelected],
  );

  /** Resolve every selected string ID, including rows not yet loaded in the grid. */
  const resolveSelectedIds = useCallback(async (): Promise<number[]> => {
    if (selectAllMatching) {
      const { ids: all } = await api.strings.matchingIds({ modId, ...buildFilter() });
      return selected.size ? all.filter((id) => !selected.has(id)) : all;
    }
    return [...selected];
  }, [selectAllMatching, selected, modId, buildFilter]);

  const { saveMutation, clearMutation, tmApplyMut, clearSameAsSourceMut, saveIndicator } =
    useEditorMutations({
      modId,
      srcLang,
      targetLang,
      refetchStats,
      activeRowRef,
      setActiveRow,
    });

  const aiVerify = useAiVerify(modId, srcLang, targetLang);
  const aiTranslate = useAiTranslate(modId, srcLang, targetLang);
  const skipDetect = useSkipDetect(modId, srcLang);
  const applyImported = useApplyImported(modId, srcLang, targetLang);
  const prevAiTranslateStatus = useRef(aiTranslate.status);
  const prevApplyImportedStatus = useRef(applyImported.status);
  const prevSkipDetectStatus = useRef(skipDetect.status);
  const prevAiVerifyStatus = useRef(aiVerify.status);

  useEffect(() => {
    if (
      prevAiTranslateStatus.current === 'running' &&
      (aiTranslate.status === 'completed' || aiTranslate.status === 'cancelled')
    ) {
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      void refetchStats();
    }
    prevAiTranslateStatus.current = aiTranslate.status;
  }, [aiTranslate.status, modId, qc, refetchStats]);

  // Auto-approve / auto-fix during verification update rows on the server — refresh when a run finishes.
  useEffect(() => {
    if (
      prevAiVerifyStatus.current === 'running' &&
      (aiVerify.status === 'completed' || aiVerify.status === 'cancelled') &&
      (aiVerify.approved > 0 || aiVerify.fixed > 0)
    ) {
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      void refetchStats();
    }
    prevAiVerifyStatus.current = aiVerify.status;
  }, [aiVerify.status, aiVerify.approved, aiVerify.fixed, modId, qc, refetchStats]);

  useEffect(() => {
    if (
      prevApplyImportedStatus.current === 'running' &&
      (applyImported.status === 'completed' || applyImported.status === 'cancelled')
    ) {
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      void refetchStats();
    }
    prevApplyImportedStatus.current = applyImported.status;
  }, [applyImported.status, modId, qc, refetchStats]);

  useEffect(() => {
    if (
      prevSkipDetectStatus.current === 'running' &&
      (skipDetect.status === 'completed' || skipDetect.status === 'cancelled')
    ) {
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      void refetchStats();
    }
    prevSkipDetectStatus.current = skipDetect.status;
  }, [skipDetect.status, modId, qc, refetchStats]);

  const { flushAutosave, cancelAutosave } = useAutosave({
    activeRow,
    draftTranslation,
    onSave: (stringId, text) => saveMutation.mutate({ stringId, text }),
    onClear: (stringId) => clearMutation.mutate({ stringId }),
  });

  // ── Column-filter / sort handlers ──

  const handleColumnFilterChange = useCallback(
    (col: keyof ColumnFilters, value: string) => {
      setColumnFilters((prev) => ({ ...prev, [col]: value }));
      clearSelection();
    },
    [clearSelection],
  );

  /** Toggles sort direction for a column, or activates sorting on it. */
  const handleSort = useCallback(
    (col: SortCol) => {
      if (sortCol === col) {
        if (sortDir === 'asc') setSortDir('desc');
        else {
          setSortCol(null);
          setSortDir('asc');
        }
      } else {
        setSortCol(col);
        setSortDir('asc');
      }
      clearSelection();
    },
    [sortCol, sortDir, clearSelection],
  );

  // ── Sync status / qaOnly to URL search params ──
  useEffect(() => {
    const currentStatus = searchParams.get('status') ?? '';
    const currentQaOnly =
      searchParams.get('qaOnly') === '1' || searchParams.get('qaOnly') === 'true';
    const nextStatus = statusParamFromSelection(selectedStatuses) ?? '';
    if (currentStatus === nextStatus && currentQaOnly === qaOnly) return;
    const next = new URLSearchParams(searchParams);
    if (nextStatus) next.set('status', nextStatus);
    else next.delete('status');
    if (qaOnly) next.set('qaOnly', '1');
    else next.delete('qaOnly');
    setSearchParams(next, { replace: true });
  }, [selectedStatuses, qaOnly, searchParams, setSearchParams]);

  /** Drop an active GRUP filter when it has no rows under the current status filter. */
  useEffect(() => {
    if (!signature || !sigCounts.length) return;
    if (!sigCounts.some((row) => row.signature === signature && Number(row.count) > 0)) {
      setSignature('');
    }
  }, [signature, sigCounts]);

  // ── Action helpers ──

  const handleRowSelect = useCallback(
    (row: StringRow) => {
      setFocusedRow(row);
      if (!activeRow) return;
      if (activeRow.string_id === row.string_id) return;
      flushAutosave();
      setActiveRow(row);
      setDraftTranslation(row.translation ?? '');
      setActiveTab('suggestions');
    },
    [activeRow, flushAutosave],
  );

  const handleRowOpen = useCallback(
    (row: StringRow) => {
      flushAutosave();
      setActiveRow(row);
      setFocusedRow(row);
      setDraftTranslation(row.translation ?? '');
      setActiveTab('suggestions');
    },
    [flushAutosave],
  );

  const handleCopySource = () => {
    if (!activeRow) return;
    setDraftTranslation(activeRow.source);
  };

  const handleSave = () => {
    cancelAutosave();
    if (!activeRow) return;
    if (draftTranslation.trim() === '') {
      handleClear(activeRow);
      return;
    }
    saveMutation.mutate({ stringId: activeRow.string_id, text: draftTranslation });
  };

  const handleClear = (row: StringRow) => {
    clearMutation.mutate({ stringId: row.string_id });
    if (activeRow?.string_id === row.string_id) {
      setActiveRow({
        ...row,
        translation: null,
        translation_id: null,
        status: null,
        qa_issue_count: 0,
      });
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

  /**
   * Header checkbox: select every row matching the current filter, or clear
   * the selection when everything is already selected.
   */
  const toggleAll = useCallback(() => {
    if (allSelected) {
      clearSelection();
    } else {
      setSelectAllMatching(true);
      setSelected(new Set());
    }
  }, [allSelected, clearSelection]);

  const handleBatchTranslate = async () => {
    if (translateInFlight.current) return;

    // Resolve the target ID list. In "all matching" mode we fetch the full
    // filtered set from the server (minus de-selections) so the action covers
    // rows that have not been scrolled into memory yet.
    let ids: number[];
    try {
      ids = await resolveSelectedIds();
    } catch (err) {
      setTranslateError(String(err));
      return;
    }
    if (ids.length === 0) return;

    translateInFlight.current = true;
    setTranslateError(null);
    setTranslateDoneCount(null);
    setTranslateProgress({ done: 0, total: ids.length });
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
      const results = await api.strings.batchTranslate(
        ids,
        srcLang,
        targetLang,
        (e) => {
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
        },
        modId,
      );
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      void refetchStats();
      const doneCount = results.filter((r) => r.text !== undefined).length;
      setTranslateDoneCount(doneCount);
      clearSelection();
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

  /** True when a context-menu action should target the whole selection. */
  const ctxActsOnSelection = useCallback(
    (row: StringRow) => hasSelection && isRowSelected(row.string_id),
    [hasSelection, isRowSelected],
  );

  // Per-row text operations act on the loaded selected rows when invoked on a
  // selection, otherwise on the clicked row.
  const applyTextTransform = useCallback(
    async (row: StringRow, transform: (text: string) => string) => {
      const targetRows = ctxActsOnSelection(row)
        ? selectedLoadedRows().filter((r) => r.translation)
        : row.translation
          ? [row]
          : [];
      for (const r of targetRows) {
        const newText = transform(r.translation!);
        if (newText !== r.translation)
          await api.strings.saveTranslation(r.string_id, newText, 'draft', targetLang);
      }
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      void refetchStats();
    },
    [ctxActsOnSelection, selectedLoadedRows, targetLang, qc, modId, refetchStats],
  );

  const ctxCopySource = useCallback(
    async (row: StringRow) => {
      const targetRows = ctxActsOnSelection(row) ? selectedLoadedRows() : [row];
      for (const r of targetRows) {
        await api.strings.saveTranslation(r.string_id, r.source, 'draft', targetLang);
      }
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      void refetchStats();
    },
    [ctxActsOnSelection, selectedLoadedRows, targetLang, qc, modId, refetchStats],
  );

  /** Patch loaded grid rows after a bulk clear (instant UI, no refetch storm). */
  const patchClearedInCache = useCallback(
    (matchRow: (row: StringRow) => boolean) => {
      qc.setQueriesData<InfiniteData<StringsResult>>({ queryKey: ['strings', modId] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            rows: page.rows.map((r) =>
              matchRow(r)
                ? {
                    ...r,
                    translation: null,
                    translation_id: null,
                    status: null,
                    qa_issue_count: 0,
                  }
                : r,
            ),
          })),
        };
      });
    },
    [qc, modId],
  );

  /** Context-menu clear: whole selection (all matching IDs) or just the clicked row. */
  const ctxClear = useCallback(
    async (row: StringRow) => {
      if (ctxActsOnSelection(row)) {
        patchClearedInCache((r) => isRowSelected(r.string_id));
        try {
          if (selectAllMatching) {
            await api.strings.batchClearTranslations({
              modId,
              filter: buildFilter(),
              excludeIds: selected.size ? [...selected] : undefined,
              targetLang,
            });
          } else {
            await api.strings.batchClearTranslations({ stringIds: [...selected], targetLang });
          }
          void refetchStats();
          const activeId = activeRowRef.current?.string_id;
          if (activeId && isRowSelected(activeId)) {
            setActiveRow((prev) =>
              prev
                ? {
                    ...prev,
                    translation: null,
                    translation_id: null,
                    status: null,
                    qa_issue_count: 0,
                  }
                : prev,
            );
            setDraftTranslation('');
          }
          clearSelection();
        } catch {
          qc.invalidateQueries({ queryKey: ['strings', modId] });
        }
      } else {
        handleClear(row);
      }
    },
    // handleClear is a stable-enough page handler; intentionally omitted.
    [
      ctxActsOnSelection,
      selectAllMatching,
      modId,
      buildFilter,
      selected,
      targetLang,
      patchClearedInCache,
      isRowSelected,
      refetchStats,
      clearSelection,
      qc,
    ], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** Programmatic "next QA issue" navigation — mirrors the `q` key shortcut. */
  const handleNextQaIssue = useCallback(() => {
    if (!strings?.rows.length) return;
    const rows = strings.rows;
    const current = activeRow ?? focusedRow;
    const curIdx = current ? rows.findIndex((r) => r.string_id === current.string_id) : -1;
    for (let i = 1; i <= rows.length; i++) {
      const idx = (curIdx + i) % rows.length;
      if (rows[idx].qa_issue_count > 0) {
        handleRowOpen(rows[idx]);
        break;
      }
    }
  }, [strings, activeRow, focusedRow, handleRowOpen]);

  const qaIssueRowCount = strings?.rows.filter((row) => row.qa_issue_count > 0).length ?? 0;

  // ── Keyboard shortcuts ──
  useEditorKeyboard({
    activeRow,
    focusedRow,
    hasSelection,
    strings,
    ctxMenu,
    translAreaRef,
    flushAutosave,
    handleSave,
    handleCopySource,
    handleClear,
    handleRowOpen,
    handleRowSelect,
    handleNextQaIssue,
    toggleAll,
    clearSelection,
    setActiveRow,
    setDraftTranslation,
    setSelected,
    setCtxMenu,
    setShowShortcuts,
  });

  // ── Render ──
  return (
    <div className={styles.root}>
      <EditorToolbar
        modName={mod?.name}
        srcLang={srcLang}
        targetLang={targetLang}
        availLangs={availLangs}
        selectedStatuses={selectedStatuses}
        qaOnly={qaOnly}
        stats={stats}
        selectedCount={selectedCount}
        translateProgress={translateProgress}
        translateError={translateError}
        tmApply={{
          isPending: tmApplyMut.isPending,
          isSuccess: tmApplyMut.isSuccess,
          applied: (tmApplyMut.data as { applied: number } | undefined)?.applied ?? 0,
        }}
        clearSameAsSource={{
          isPending: clearSameAsSourceMut.isPending,
          isSuccess: clearSameAsSourceMut.isSuccess,
          cleared: clearSameAsSourceMut.data?.cleared ?? 0,
        }}
        gameId={gameId}
        modId={modId}
        hasInnrSignature={!!sigs?.some((s: { signature: string }) => s.signature === 'INNR')}
        hasBookSignature={!!sigs?.some((s: { signature: string }) => s.signature === 'BOOK')}
        qaIssueRowCount={qaIssueRowCount}
        onSrcLangChange={(l) => {
          setSrcLang(l);
          clearSelection();
        }}
        onTargetLangChange={(l) => {
          setTargetLang(l);
          clearSelection();
        }}
        onSelectedStatusesChange={(next) => {
          setSelectedStatuses(next);
          clearSelection();
        }}
        onQaOnlyToggle={() => {
          setQaOnly((v) => !v);
          clearSelection();
        }}
        onTmApply={() => tmApplyMut.mutate()}
        onClearSameAsSource={() => clearSameAsSourceMut.mutate()}
        onSearchReplace={() => setShowSearchReplace(true)}
        onApplyTranslationFromMod={() => setShowApplyTranslationFromMod(true)}
        applyImportedRunning={applyImported.isRunning}
        onAiVerify={() => setShowAiVerify(true)}
        onAiTranslate={() => setShowAiTranslate(true)}
        onSkipDetect={() => setShowSkipDetect(true)}
        aiVerifyRunning={aiVerify.isRunning}
        aiTranslateRunning={aiTranslate.isRunning}
        skipDetectRunning={skipDetect.isRunning}
        onShortcuts={() => setShowShortcuts((v) => !v)}
        onBatchTranslate={handleBatchTranslate}
        onNextQaIssue={handleNextQaIssue}
        pageMode={pageMode}
        onPageModeChange={setPageMode}
      />

      {/* Post-LLM-run action banner — shown after a successful batch translate */}
      {translateDoneCount !== null && (
        <div className={styles.translateBanner}>
          <span>{t('modEditor.translateDone', { count: translateDoneCount })}</span>
          <button
            className={styles.translateBannerLink}
            onClick={() => {
              setSelectedStatuses(['draft']);
              setTranslateDoneCount(null);
            }}
          >
            {t('modEditor.showDraftsAction')}
          </button>
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
      {pageMode === 'dialogs' ? (
        <DialogsMode modId={modId} srcLang={srcLang} targetLang={targetLang} />
      ) : (
        <div className={styles.body}>
          <SignaturePanel
            sigCounts={sigCounts}
            activeSignature={signature}
            totalFiltered={strings?.total}
            statusFilterActive={selectedStatuses.length > 0}
            modTotal={stats?.total}
            onSelect={(sig) => {
              setSignature(sig);
              clearSelection();
            }}
          />

          <div className={styles.centerCol}>
            <StringGrid
              rows={strings?.rows ?? []}
              total={total}
              isLoading={isLoading}
              isRowSelected={isRowSelected}
              allSelected={allSelected}
              someSelected={someSelected}
              hasMore={!!hasNextPage}
              isFetchingMore={isFetchingNextPage}
              onLoadMore={() => fetchNextPage()}
              activeRow={activeRow}
              focusedRow={focusedRow}
              srcLang={srcLang}
              targetLang={targetLang}
              sortCol={sortCol}
              sortDir={sortDir}
              columnFilters={columnFilters}
              onRowSelect={handleRowSelect}
              onRowOpen={handleRowOpen}
              onToggleRow={toggleRow}
              onToggleAll={toggleAll}
              onSort={handleSort}
              onColumnFilterChange={handleColumnFilterChange}
              onContextMenu={handleContextMenu}
              onClear={handleClear}
              onCopySource={(row) => {
                handleRowOpen(row);
                setTimeout(() => setDraftTranslation(row.source), 0);
              }}
            />

            {activeRow && (
              <DetailPanel
                modId={modId}
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
                onTabChange={setActiveTab}
                onOpenBookEditor={() => setShowBookEditor(true)}
              />
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      {showSearchReplace && (
        <SearchReplaceModal
          modId={modId}
          targetLang={targetLang}
          onClose={() => setShowSearchReplace(false)}
          onApplied={() => {
            qc.invalidateQueries({ queryKey: ['strings', modId] });
          }}
        />
      )}
      {showApplyTranslationFromMod && gameId && (
        <ApplyTranslationFromModModal
          modId={modId}
          gameId={gameId}
          srcLang={srcLang}
          targetLang={targetLang}
          job={applyImported}
          onClose={() => setShowApplyTranslationFromMod(false)}
        />
      )}
      {showAiTranslate && (
        <AiTranslateModal
          srcLang={srcLang}
          targetLang={targetLang}
          state={aiTranslate}
          onClose={() => setShowAiTranslate(false)}
          onRowClick={(stringId) => {
            const row = strings?.rows.find((r) => r.string_id === stringId);
            if (row) {
              handleRowOpen(row);
              setShowAiTranslate(false);
            }
          }}
        />
      )}
      {showAiVerify && (
        <AiVerifyModal
          srcLang={srcLang}
          targetLang={targetLang}
          state={aiVerify}
          onClose={() => setShowAiVerify(false)}
          onRowClick={(stringId) => {
            const row = strings?.rows.find((r) => r.string_id === stringId);
            if (row) {
              handleRowOpen(row);
              setShowAiVerify(false);
            }
          }}
          onApplySuggestion={async (issue) => {
            if (!issue.suggestion) return;
            await api.strings.saveTranslation(issue.stringId, issue.suggestion, 'auto', targetLang);
            qc.invalidateQueries({ queryKey: ['strings', modId] });
            void refetchStats();
          }}
          onApplyAllSuggestions={async (batch) => {
            for (const issue of batch) {
              if (!issue.suggestion) continue;
              await api.strings.saveTranslation(
                issue.stringId,
                issue.suggestion,
                'auto',
                targetLang,
              );
            }
            qc.invalidateQueries({ queryKey: ['strings', modId] });
            void refetchStats();
          }}
        />
      )}
      {showSkipDetect && (
        <SkipTranslateModal
          srcLang={srcLang}
          state={skipDetect}
          onClose={() => setShowSkipDetect(false)}
          onRowClick={(stringId) => {
            const row = strings?.rows.find((r) => r.string_id === stringId);
            if (row) {
              handleRowOpen(row);
              setShowSkipDetect(false);
            }
          }}
          onApply={async (candidate) => {
            await api.strings.markSkip([candidate.stringId]);
            qc.invalidateQueries({ queryKey: ['strings', modId] });
            void refetchStats();
          }}
          onApplyAll={async (batch, onProgress) => {
            const ids = batch.map((c) => c.stringId);
            const CHUNK_SIZE = 100;
            for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
              const chunk = ids.slice(i, i + CHUNK_SIZE);
              await api.strings.markSkip(chunk);
              onProgress?.(Math.min(i + chunk.length, ids.length), ids.length);
            }
            qc.invalidateQueries({ queryKey: ['strings', modId] });
            void refetchStats();
          }}
        />
      )}
      {showBookEditor && activeRow && (
        <BookEditorModal
          source={activeRow.source}
          translation={draftTranslation}
          onSave={(markup) => {
            setDraftTranslation(markup);
            setShowBookEditor(false);
          }}
          onClose={() => setShowBookEditor(false)}
        />
      )}
      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          anchor={ctxMenu}
          selectedCount={selectedCount}
          actsOnSelection={ctxActsOnSelection(ctxMenu.row)}
          onClose={() => setCtxMenu(null)}
          onClear={ctxClear}
          onCopySource={(row) => {
            handleRowOpen(row);
            setTimeout(() => setDraftTranslation(row.source), 0);
          }}
          onTextTransform={applyTextTransform}
          onBulkCopySource={ctxCopySource}
          onBatchTranslate={handleBatchTranslate}
        />
      )}

      <EditorStatusBar
        selectedCount={selectedCount}
        activeRow={focusedRow ?? activeRow}
        stats={stats}
      />
    </div>
  );
};
