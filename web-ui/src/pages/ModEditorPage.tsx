import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { api, type QAIssue, type StringRow, type TMSuggestion, type TranslationHistoryEntry } from '../api';
import { getSrcLang, getTgtLang, SUPPORTED_CONTENT_LANGUAGES } from '../langDefaults';
import { StatusBadge, ProgressBar } from '../components/StatusBadge';
import { BookEditorModal } from '../components/BookEditorModal';
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

/** Keys identifying each resizable column in the string grid. */
type ColKey = 'grup' | 'formid' | 'edid' | 'field' | 'src' | 'transl' | 'act';

/** Column keys that support server-side sorting (all except checkbox and actions). */
type SortCol = 'grup' | 'formid' | 'edid' | 'field' | 'src' | 'transl';
type SortDir = 'asc' | 'desc';

export const ModEditorPage = () => {
  const { t } = useTranslation();
  const { id, gameId } = useParams<{ id: string; gameId: string }>();
  const modId = Number(id);
  const qc = useQueryClient();

  // Filters
  const [srcLang, setSrcLang] = useState(getSrcLang());
  const [targetLang, setTargetLang] = useState(getTgtLang());
  const [status, setStatus] = useState('all');
  const [signature, setSignature] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  // Per-column filters (filter row above the grid header)
  const [grupFilter, setGrupFilter] = useState('');
  const [formidFilter, setFormidFilter] = useState('');
  const [edidFilter, setEdidFilter] = useState('');
  const [fieldFilter, setFieldFilter] = useState('');
  const [srcFilter, setSrcFilter] = useState('');
  const [translFilter, setTranslFilter] = useState('');

  // Sorting
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

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
  /** Whether the Book/HTML editor modal is open for the current active row. */
  const [showBookEditor, setShowBookEditor] = useState(false);

  // Keyboard shortcuts help panel
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Hidden file input ref for "Update Mod" — uploads a new version of the current mod
  const updateFileRef = useRef<HTMLInputElement>(null);
  const [updating, setUpdating] = useState(false);
  const navigate = useNavigate();

  /**
   * Handles "Update Mod": uploads the selected file as a new import job, starts
   * it immediately (localized) or shows the preview modal, then navigates to the
   * Diff page with the new and current mod IDs pre-filled.
   */
  const handleUpdateMod = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUpdating(true);
    try {
      const job = await api.modImport.upload(file);
      if (!job) return;
      // Start import immediately for localized mods; non-localized still need language selection
      if (job.is_localized) {
        const { promise } = api.modImport.startImport(job.id, () => {});
        await promise;
      }
      // Fetch updated job to get the new mod_id
      const jobs = await api.modImport.list();
      const finished = jobs.find((j) => j.id === job.id);
      if (finished?.mod_id) {
        navigate(`/diff?newModId=${finished.mod_id}&oldModId=${modId}`);
      }
    } catch {/* ignore — user sees nothing happen */} finally {
      setUpdating(false);
      if (updateFileRef.current) updateFileRef.current.value = '';
    }
  };

  // Context menu state — position and the row it was triggered on
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; row: StringRow } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  /**
   * After the context menu mounts, measures it and flips horizontally/vertically
   * so the menu stays fully visible within the viewport.
   */
  useEffect(() => {
    if (!ctxMenu || !ctxMenuRef.current) return;
    const el = ctxMenuRef.current;
    const rect = el.getBoundingClientRect();
    let x = ctxMenu.x;
    let y = ctxMenu.y;
    if (x + rect.width > window.innerWidth) x = Math.max(0, x - rect.width);
    if (y + rect.height > window.innerHeight) y = Math.max(0, y - rect.height);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.opacity = '1';
  }, [ctxMenu]);

  // Resizable column widths in px. null = flex-fill (auto-size). Updated while dragging.
  const [colWidths, setColWidths] = useState<Record<ColKey, number | null>>({
    grup: 52, formid: 70, edid: 160, field: 50, src: null, transl: null, act: 170,
  });
  const resizeRef = useRef<{ col: ColKey; startX: number; startW: number } | null>(null);

  /**
   * Initiates a column resize drag. Reads the current rendered width of the
   * header cell from the DOM, then tracks mousemove to adjust the column width.
   * Global listeners are cleaned up automatically on mouseup.
   */
  const startResize = useCallback((col: ColKey, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const thEl = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
    const startW = thEl.getBoundingClientRect().width;
    resizeRef.current = { col, startX: e.clientX, startW };
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = ev.clientX - resizeRef.current.startX;
      const newW = Math.max(30, resizeRef.current.startW + delta);
      setColWidths((prev) => ({ ...prev, [resizeRef.current!.col]: newW }));
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  /**
   * Returns the inline CSS style for a resizable column cell.
   * Uses a fixed flex-basis (px) when the user has resized it; flex-fill otherwise.
   */
  const colStyle = useCallback((col: ColKey): React.CSSProperties => {
    const w = colWidths[col];
    return w !== null
      ? { flex: `0 0 ${w}px`, overflow: 'hidden' }
      : { flex: 1, minWidth: 180, overflow: 'hidden' };
  }, [colWidths]);

  /**
   * Toggles sort direction for the given column, or activates sorting on it.
   * Clicking the same column cycles: asc → desc → off.
   */
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

  const stringsKey = ['strings', modId, srcLang, targetLang, status, signature, query, grupFilter, formidFilter, edidFilter, fieldFilter, srcFilter, translFilter, page, sortCol, sortDir];

  const { data: mod } = useQuery({ queryKey: ['mods', modId], queryFn: () => api.mods.get(modId) });
  const { data: langs } = useQuery({ queryKey: ['langs', modId], queryFn: () => api.mods.langs(modId) });
  const { data: sigs } = useQuery({ queryKey: ['sigs', modId, srcLang], queryFn: () => api.strings.signatures(modId, srcLang) });
  const { data: stats, refetch: refetchStats } = useQuery({ queryKey: ['stats', modId], queryFn: () => api.stats.mod(modId) });
  const { data: strings, isLoading } = useQuery({
    queryKey: stringsKey,
    queryFn: () => api.strings.list({ modId, srcLang, targetLang, status: status === 'all' ? undefined : status, signature: signature || undefined, q: query || undefined, grup: grupFilter || undefined, formid: formidFilter || undefined, edid: edidFilter || undefined, field: fieldFilter || undefined, src: srcFilter || undefined, transl: translFilter || undefined, page, pageSize: PAGE_SIZE, sort: sortCol ?? undefined, order: sortCol ? sortDir : undefined }),
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
      // Skip when typing in input/textarea/select (except Escape, Ctrl+S, Ctrl+Shift combos)
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

      // Escape — close context menu, detail panel, or clear selection
      if (e.key === 'Escape') {
        e.preventDefault();
        if (ctxMenu) { setCtxMenu(null); return; }
        if (activeRow) { flushAutosave(); setActiveRow(null); setDraftTranslation(''); }
        else if (selected.size > 0) setSelected(new Set());
        return;
      }

      // Ctrl+S — save translation (works even inside textarea)
      if (e.key === 's' && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        handleSave();
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

      // Ctrl+Shift+C — copy source to translation
      if (e.key === 'C' && e.ctrlKey && e.shiftKey && !e.altKey) {
        e.preventDefault();
        handleCopySource();
        return;
      }

      // Ctrl+Shift+X — clear translation
      if (e.key === 'X' && e.ctrlKey && e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (activeRow) handleClear(activeRow);
        return;
      }

      // Ctrl+Shift+E — toggle detail panel (open/close)
      if (e.key === 'E' && e.ctrlKey && e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (activeRow) { flushAutosave(); setActiveRow(null); setDraftTranslation(''); }
        else if (strings?.rows.length) handleRowClick(strings.rows[0]);
        return;
      }

      // ? — toggle keyboard shortcuts help (only outside text fields)
      if (e.key === '?' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }

      // Remaining shortcuts only work outside text fields
      if (isInput) return;

      // Arrow keys — navigate rows
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
        return;
      }

      // N — jump to next untranslated row
      if (e.key === 'n' && !e.ctrlKey && !e.altKey && !e.shiftKey && strings?.rows.length) {
        e.preventDefault();
        const rows = strings.rows;
        const curIdx = activeRow ? rows.findIndex((r) => r.string_id === activeRow.string_id) : -1;
        // Search forward from current position, wrapping around
        for (let i = 1; i <= rows.length; i++) {
          const idx = (curIdx + i) % rows.length;
          if (!rows[idx].translation) { handleRowClick(rows[idx]); break; }
        }
        return;
      }

      // Enter — focus the translation textarea in detail panel
      if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (activeRow) {
          e.preventDefault();
          const textarea = document.querySelector<HTMLTextAreaElement>(`.${styles.translArea}`);
          textarea?.focus();
        }
        return;
      }

      // Space — toggle selection on active row
      if (e.key === ' ' && !e.ctrlKey && !e.altKey && !e.shiftKey && activeRow) {
        e.preventDefault();
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(activeRow.string_id)) next.delete(activeRow.string_id);
          else next.add(activeRow.string_id);
          return next;
        });
        return;
      }

      // Ctrl+A — select / deselect all rows on current page
      if (e.key === 'a' && e.ctrlKey && !e.shiftKey && !e.altKey && strings?.rows.length) {
        e.preventDefault();
        toggleAll();
        return;
      }

      // PageDown — next page
      if (e.key === 'PageDown' && strings) {
        e.preventDefault();
        const totalPages = Math.ceil(strings.total / PAGE_SIZE);
        if (page < totalPages) setPage(page + 1);
        return;
      }

      // PageUp — previous page
      if (e.key === 'PageUp' && strings) {
        e.preventDefault();
        if (page > 1) setPage(page - 1);
        return;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeRow, selected, strings, ctxMenu, page]);

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

  // ── Context menu handlers ──

  /** Opens context menu at mouse position for the given row. */
  const handleContextMenu = useCallback((e: React.MouseEvent, row: StringRow) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, row });
  }, []);

  /** Closes the context menu. */
  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  /** Close context menu when clicking outside. */
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = () => setCtxMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [ctxMenu]);

  /**
   * Applies a text transform function to one or many rows' translations.
   * If multiple rows are selected and the right-clicked row is among them,
   * the transform applies to all selected rows. Otherwise only to the clicked row.
   */
  const applyTextTransform = useCallback(async (row: StringRow, transform: (text: string) => string) => {
    const targetRows = (selected.size > 1 && selected.has(row.string_id))
      ? strings?.rows.filter((r) => selected.has(r.string_id) && r.translation) ?? []
      : row.translation ? [row] : [];
    for (const r of targetRows) {
      const newText = transform(r.translation!);
      if (newText !== r.translation) {
        await api.strings.saveTranslation(r.string_id, newText, 'draft', targetLang);
      }
    }
    qc.invalidateQueries({ queryKey: ['strings', modId] });
    void refetchStats();
  }, [selected, strings, targetLang, qc, modId, refetchStats]);

  /** Copies the source text to translation for single or multiple rows. */
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

  const totalPages = strings ? Math.ceil(strings.total / PAGE_SIZE) : 1;

  // Group counts by signature for left panel
  const sigCounts = sigs ?? [];

  // Always show the full supported language list in selectors.
  // Append any extra language codes returned by API (if present) so nothing is lost.
  const availLangs = useMemo(() => {
    const base = [...SUPPORTED_CONTENT_LANGUAGES] as string[];
    if (!langs || langs.length === 0) return base;
    for (const code of langs) {
      if (!base.includes(code)) {
        base.push(code);
      }
    }
    return base;
  }, [langs]);

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
        {/* Show INNR editor button only when the mod contains INNR records */}
        {sigs?.some((s: { signature: string }) => s.signature === 'INNR') && (
          <Link to={`/games/${gameId}/mods/${modId}/innr`} className={styles.btnSec} title={t('modEditor.innrEditorTitle')}>
            {t('modEditor.innrEditor')}
          </Link>
        )}
        {/* Update mod — upload a newer version of this mod and go to the Diff page */}
        <input
          ref={updateFileRef}
          type="file"
          accept=".esp,.esm,.esl,.zip,.7z,.rar"
          style={{ display: 'none' }}
          onChange={handleUpdateMod}
        />
        <button
          onClick={() => updateFileRef.current?.click()}
          disabled={updating}
          className={styles.btnSec}
          title={t('modEditor.updateModTitle')}
        >
          {updating ? t('modEditor.updating') : t('modEditor.updateMod')}
        </button>
        <button onClick={() => setShowShortcuts((v) => !v)} className={styles.btnSec} title={t('modEditor.shortcuts')}>?</button>
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
                  <div className={`${styles.th} ${styles.sortable}`} style={colStyle('grup')} onClick={() => handleSort('grup')}>
                    {t('modEditor.grup')}
                    {sortCol === 'grup' && <span className={styles.sortIcon}>{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
                    <span className={styles.resizeHandle} onMouseDown={(e) => startResize('grup', e)} />
                  </div>
                  <div className={`${styles.th} ${styles.sortable}`} style={colStyle('formid')} onClick={() => handleSort('formid')}>
                    {t('modEditor.formId')}
                    {sortCol === 'formid' && <span className={styles.sortIcon}>{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
                    <span className={styles.resizeHandle} onMouseDown={(e) => startResize('formid', e)} />
                  </div>
                  <div className={`${styles.th} ${styles.sortable}`} style={colStyle('edid')} onClick={() => handleSort('edid')}>
                    {t('modEditor.edid')}
                    {sortCol === 'edid' && <span className={styles.sortIcon}>{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
                    <span className={styles.resizeHandle} onMouseDown={(e) => startResize('edid', e)} />
                  </div>
                  <div className={`${styles.th} ${styles.sortable}`} style={colStyle('field')} onClick={() => handleSort('field')}>
                    {t('modEditor.field')}
                    {sortCol === 'field' && <span className={styles.sortIcon}>{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
                    <span className={styles.resizeHandle} onMouseDown={(e) => startResize('field', e)} />
                  </div>
                  <div className={`${styles.th} ${styles.sortable}`} style={colStyle('src')} onClick={() => handleSort('src')}>
                    {t('modEditor.sourceText', { lang: srcLang.toUpperCase() })}
                    {sortCol === 'src' && <span className={styles.sortIcon}>{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
                    <span className={styles.resizeHandle} onMouseDown={(e) => startResize('src', e)} />
                  </div>
                  <div className={`${styles.th} ${styles.sortable}`} style={colStyle('transl')} onClick={() => handleSort('transl')}>
                    {t('modEditor.translationText', { lang: targetLang.toUpperCase() })}
                    {sortCol === 'transl' && <span className={styles.sortIcon}>{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
                    <span className={styles.resizeHandle} onMouseDown={(e) => startResize('transl', e)} />
                  </div>
                  <div className={styles.th} style={colStyle('act')}>
                    {t('modEditor.actions')}
                    <span className={styles.resizeHandle} onMouseDown={(e) => startResize('act', e)} />
                  </div>
                </div>

                {/* per-column filter row */}
                <div className={styles.filterRow}>
                  <div className={styles.colCheck} />
                  <div style={colStyle('grup')}>
                    <input className={styles.filterInput} placeholder={t('modEditor.grup')} value={grupFilter} onChange={(e) => { setGrupFilter(e.target.value); setPage(1); }} />
                  </div>
                  <div style={colStyle('formid')}>
                    <input className={styles.filterInput} placeholder={t('modEditor.formId')} value={formidFilter} onChange={(e) => { setFormidFilter(e.target.value); setPage(1); }} />
                  </div>
                  <div style={colStyle('edid')}>
                    <input className={styles.filterInput} placeholder={t('modEditor.edid')} value={edidFilter} onChange={(e) => { setEdidFilter(e.target.value); setPage(1); }} />
                  </div>
                  <div style={colStyle('field')}>
                    <input className={styles.filterInput} placeholder={t('modEditor.field')} value={fieldFilter} onChange={(e) => { setFieldFilter(e.target.value); setPage(1); }} />
                  </div>
                  <div style={colStyle('src')}>
                    <input className={styles.filterInput} placeholder={t('modEditor.sourceText', { lang: srcLang.toUpperCase() })} value={srcFilter} onChange={(e) => { setSrcFilter(e.target.value); setPage(1); }} />
                  </div>
                  <div style={colStyle('transl')}>
                    <input className={styles.filterInput} placeholder={t('modEditor.translationText', { lang: targetLang.toUpperCase() })} value={translFilter} onChange={(e) => { setTranslFilter(e.target.value); setPage(1); }} />
                  </div>
                  <div style={colStyle('act')} />
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
                        onContextMenu={(e) => handleContextMenu(e, row)}
                      >
                        <div className={`${styles.td} ${styles.colCheck}`} onClick={(e) => toggleRow(row, e)}>
                          <input type="checkbox" checked={selected.has(row.string_id)} onChange={() => {}} />
                        </div>
                        <div className={styles.tdSig} style={colStyle('grup')}>{row.signature}</div>
                        <div className={styles.tdFid} style={colStyle('formid')}>{row.formid_hex}</div>
                        <div className={styles.tdEdidCell} style={colStyle('edid')} title={row.edid ?? ''}>{row.edid ?? ''}</div>
                        <div className={styles.tdField} style={colStyle('field')}>{row.path?.split('\\').pop() ?? ''}</div>
                        <div className={styles.tdText} style={colStyle('src')} title={row.source}>{row.source}</div>
                        <div className={row.translation ? styles.tdTranslFilled : styles.tdTranslEmpty} style={colStyle('transl')} title={row.translation ?? ''}>
                          {row.translation ?? '—'}
                          {row.qa_issue_count > 0 && (
                            <span className={styles.qaHint}>{row.qa_issue_count} QA</span>
                          )}
                        </div>
                        <div className={`${styles.td} ${styles.colAct}`} style={colStyle('act')} onClick={(e) => e.stopPropagation()}>
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
                  <div className={styles.panelLabel}>
                    {t('modEditor.translationTextLabel', { lang: targetLang.toUpperCase() })}
                    {/* Show the Book editor button when the record is a BOOK or the source contains HTML markup */}
                    {(activeRow.signature === 'BOOK' || /<[a-zA-Z]/.test(activeRow.source)) && (
                      <button
                        className={styles.btnSec}
                        style={{ marginLeft: 'auto', padding: '2px 10px', fontSize: '12px' }}
                        onClick={() => setShowBookEditor(true)}
                        title={t('bookEditor.openBtn')}
                      >
                        📖 {t('bookEditor.openBtn')}
                      </button>
                    )}
                  </div>
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

      {/* Book / HTML editor modal — for BOOK records and records with HTML markup */}
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

      {/* Keyboard shortcuts help overlay */}
      {showShortcuts && (
        <div className={styles.shortcutsOverlay} onClick={() => setShowShortcuts(false)}>
          <div className={styles.shortcutsPanel} onClick={(e) => e.stopPropagation()}>
            <div className={styles.shortcutsTitle}>{t('modEditor.shortcuts')}</div>
            <table className={styles.shortcutsTable}>
              <tbody>
                <tr><td className={styles.kbdCell}><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>{t('modEditor.shortcutSave')}</td></tr>
                <tr><td className={styles.kbdCell}><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd></td><td>{t('modEditor.shortcutApprove')}</td></tr>
                <tr><td className={styles.kbdCell}><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd></td><td>{t('modEditor.shortcutReject')}</td></tr>
                <tr><td className={styles.kbdCell}><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd></td><td>{t('modEditor.shortcutCopySource')}</td></tr>
                <tr><td className={styles.kbdCell}><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd></td><td>{t('modEditor.shortcutClear')}</td></tr>
                <tr><td className={styles.kbdCell}><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd></td><td>{t('modEditor.shortcutToggleDetail')}</td></tr>
                <tr><td className={styles.kbdCell}><kbd>↑</kbd> <kbd>↓</kbd></td><td>{t('modEditor.shortcutNavRows')}</td></tr>
                <tr><td className={styles.kbdCell}><kbd>N</kbd></td><td>{t('modEditor.shortcutNextUntranslated')}</td></tr>
                <tr><td className={styles.kbdCell}><kbd>Enter</kbd></td><td>{t('modEditor.shortcutFocusTextarea')}</td></tr>
                <tr><td className={styles.kbdCell}><kbd>Space</kbd></td><td>{t('modEditor.shortcutToggleSelect')}</td></tr>
                <tr><td className={styles.kbdCell}><kbd>Ctrl</kbd>+<kbd>A</kbd></td><td>{t('modEditor.shortcutSelectAll')}</td></tr>
                <tr><td className={styles.kbdCell}><kbd>PgDn</kbd> <kbd>PgUp</kbd></td><td>{t('modEditor.shortcutPageNav')}</td></tr>
                <tr><td className={styles.kbdCell}><kbd>Esc</kbd></td><td>{t('modEditor.shortcutEscape')}</td></tr>
                <tr><td className={styles.kbdCell}><kbd>?</kbd></td><td>{t('modEditor.shortcuts')}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Context menu ── */}
      {ctxMenu && (() => {
        const row = ctxMenu.row;
        const hasTrans = !!row.translation;
        const hasTransId = !!row.translation_id;
        const isBulk = selected.size > 1 && selected.has(row.string_id);
        const bulkCount = selected.size;
        return (
          <div
            ref={ctxMenuRef}
            className={styles.ctxMenu}
            style={{ top: ctxMenu.y, left: ctxMenu.x, opacity: 0 }}
            onClick={closeCtxMenu}
          >
            {/* ── Status group ── */}
            {hasTrans && hasTransId && row.status !== 'reviewed' && row.status !== 'human' && (
              <button className={styles.ctxItem} onClick={() => handleApprove(row)}>
                <span className={`${styles.ctxIcon} ${styles.ctxIconGreen}`}>✔</span>
                <span className={styles.ctxLabel}>{t('ctx.approve')}</span>
                <span className={styles.ctxKey}>Ctrl+Shift+A</span>
              </button>
            )}
            {hasTrans && hasTransId && row.status !== 'rejected' && (
              <button className={styles.ctxItem} onClick={() => rejectMutation.mutate({ stringId: row.string_id, translationId: row.translation_id! })}>
                <span className={`${styles.ctxIcon} ${styles.ctxIconRed}`}>✖</span>
                <span className={styles.ctxLabel}>{t('ctx.reject')}</span>
                <span className={styles.ctxKey}>Ctrl+Shift+R</span>
              </button>
            )}
            <button className={styles.ctxItem} onClick={() => handleClear(row)}>
              <span className={styles.ctxIcon}>⌫</span>
              <span className={styles.ctxLabel}>{t('ctx.clear')}</span>
            </button>
            <button className={styles.ctxItem} onClick={() => { handleRowClick(row); setTimeout(() => setDraftTranslation(row.source), 0); }}>
              <span className={`${styles.ctxIcon} ${styles.ctxIconGreen}`}>⤵</span>
              <span className={styles.ctxLabel}>{t('ctx.copySource')}</span>
            </button>

            {/* ── Text utilities group ── */}
            {hasTrans && (
              <>
                <div className={styles.ctxSep} />
                <button className={styles.ctxItem} onClick={() => applyTextTransform(row, (tx) => tx.toUpperCase())}>
                  <span className={`${styles.ctxIcon} ${styles.ctxIconBlue}`}>⇧</span>
                  <span className={styles.ctxLabel}>{t('ctx.uppercase')}</span>
                </button>
                <button className={styles.ctxItem} onClick={() => applyTextTransform(row, (tx) => tx.toLowerCase())}>
                  <span className={`${styles.ctxIcon} ${styles.ctxIconBlue}`}>⇩</span>
                  <span className={styles.ctxLabel}>{t('ctx.lowercase')}</span>
                </button>
                <button className={styles.ctxItem} onClick={() => applyTextTransform(row, (tx) => tx.charAt(0).toUpperCase() + tx.slice(1))}>
                  <span className={`${styles.ctxIcon} ${styles.ctxIconBlue}`}>Aa</span>
                  <span className={styles.ctxLabel}>{t('ctx.capitalize')}</span>
                </button>
                <button className={styles.ctxItem} onClick={() => applyTextTransform(row, (tx) => tx.trim())}>
                  <span className={`${styles.ctxIcon} ${styles.ctxIconBlue}`}>✂</span>
                  <span className={styles.ctxLabel}>{t('ctx.trim')}</span>
                </button>
              </>
            )}

            {/* ── Bulk group ── */}
            {isBulk && (
              <>
                <div className={styles.ctxSep} />
                <button className={styles.ctxItem} onClick={() => bulkReviewMutation.mutate({ status: 'reviewed' })}>
                  <span className={`${styles.ctxIcon} ${styles.ctxIconGreen}`}>✔</span>
                  <span className={styles.ctxLabel}>{t('ctx.bulkApprove', { count: bulkCount })}</span>
                  <span className={styles.ctxKey}>F10</span>
                </button>
                <button className={styles.ctxItem} onClick={() => bulkReviewMutation.mutate({ status: 'rejected' })}>
                  <span className={`${styles.ctxIcon} ${styles.ctxIconRed}`}>✖</span>
                  <span className={styles.ctxLabel}>{t('ctx.bulkReject', { count: bulkCount })}</span>
                </button>
                <button className={styles.ctxItem} onClick={handleBatchTranslate}>
                  <span className={`${styles.ctxIcon} ${styles.ctxIconBlue}`}>⚡</span>
                  <span className={styles.ctxLabel}>{t('ctx.bulkTranslate', { count: bulkCount })}</span>
                </button>
                <button className={styles.ctxItem} onClick={() => ctxCopySource(row)}>
                  <span className={`${styles.ctxIcon} ${styles.ctxIconGreen}`}>⤵</span>
                  <span className={styles.ctxLabel}>{t('ctx.bulkCopySource', { count: bulkCount })}</span>
                </button>
              </>
            )}
          </div>
        );
      })()}

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
  const methodLabel = (m: string) => m === 'exact' ? t('modEditor.exact') : m === 'numeric' ? t('modEditor.numeric') : m === 'punct_norm' ? t('modEditor.punct') : m === 'segment' ? t('modEditor.phrase') : t('modEditor.fuzzyMethod');
  const methodColor = (m: string) => m === 'exact' ? '#4caf50' : m === 'numeric' ? '#66bb6a' : m === 'punct_norm' ? '#ff9800' : m === 'segment' ? '#ab47bc' : '#2196f3';
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
