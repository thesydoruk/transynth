import { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useModAiJobsForMod } from '../../../hooks/useModAiJobsForMod';
import { useModAiJobsPoll } from '../../../hooks/useModAiJobsPoll';
import { useThemeObserver } from './useThemeObserver';
import { useEditorQueries } from './useEditorQueries';
import { useEditorMutations } from './useEditorMutations';
import { useAutosave } from './useAutosave';
import { useEditorKeyboard } from './useEditorKeyboard';
import { useAiVerify } from './useAiVerify';
import { useApplyImported } from './useApplyImported';
import { useEditorFilterState } from './useEditorFilterState';
import { useEditorSelection } from './useEditorSelection';
import { useEditorActiveRow } from './useEditorActiveRow';
import { useEditorBatchTranslate } from './useEditorBatchTranslate';
import { useEditorContextMenu } from './useEditorContextMenu';
import { useEditorJobEffects } from './useEditorJobEffects';
import { useEditorModals } from './useEditorModals';

const FETCH_PAGE_SIZE = 100;

/** Composes all mod-editor state, queries, mutations, and action handlers. */
export function useModEditorPage() {
  const { id, gameId } = useParams<{ id: string; gameId: string }>();
  const modId = Number(id);
  const clearSelectionRef = useRef<() => void>(() => {});
  const flushAutosaveRef = useRef<() => void>(() => {});
  const cancelAutosaveRef = useRef<() => void>(() => {});
  const saveTranslationRef = useRef<(stringId: number, text: string) => void>(() => {});
  const clearTranslationRef = useRef<(stringId: number) => void>(() => {});

  const modals = useEditorModals();
  useThemeObserver();

  const filter = useEditorFilterState({
    modId,
    clearSelection: () => clearSelectionRef.current(),
  });

  const row = useEditorActiveRow({
    flushAutosave: () => flushAutosaveRef.current(),
    cancelAutosave: () => cancelAutosaveRef.current(),
    saveTranslation: (stringId, text) => saveTranslationRef.current(stringId, text),
    clearTranslation: (stringId) => clearTranslationRef.current(stringId),
  });

  const editorQueries = useEditorQueries({
    modId,
    gameId,
    srcLang: filter.srcLang,
    targetLang: filter.targetLang,
    selectedStatuses: filter.selectedStatuses,
    qaOnly: filter.qaOnly,
    signature: filter.signature,
    columnFilters: filter.columnFilters,
    pageSize: FETCH_PAGE_SIZE,
    sortCol: filter.sortCol,
    sortDir: filter.sortDir,
    activeRow: row.activeRow,
    activeTab: row.activeTab,
  });

  useEffect(() => {
    if (!filter.signature || !editorQueries.sigCounts.length) return;
    if (
      !editorQueries.sigCounts.some(
        (sigRow) => sigRow.signature === filter.signature && Number(sigRow.count) > 0,
      )
    ) {
      filter.setSignature('');
    }
  }, [filter.signature, editorQueries.sigCounts, filter.setSignature]);

  const selection = useEditorSelection({
    modId,
    srcLang: filter.srcLang,
    targetLang: filter.targetLang,
    selectedStatuses: filter.selectedStatuses,
    qaOnly: filter.qaOnly,
    signature: filter.signature,
    columnFilters: filter.columnFilters,
    rows: editorQueries.strings?.rows,
    total: editorQueries.strings?.total ?? 0,
  });

  clearSelectionRef.current = selection.clearSelection;

  const { saveMutation, clearMutation, clearSameAsSourceMut, saveIndicator } = useEditorMutations({
    modId,
    srcLang: filter.srcLang,
    targetLang: filter.targetLang,
    refetchStats: editorQueries.refetchStats,
    activeRowRef: row.activeRowRef,
    setActiveRow: row.setActiveRow,
  });

  const { flushAutosave, cancelAutosave } = useAutosave({
    activeRow: row.activeRow,
    draftTranslation: row.draftTranslation,
    onSave: (stringId, text) => saveMutation.mutate({ stringId, text }),
    onClear: (stringId) => clearMutation.mutate({ stringId }),
  });

  flushAutosaveRef.current = flushAutosave;
  cancelAutosaveRef.current = cancelAutosave;
  saveTranslationRef.current = (stringId, text) => saveMutation.mutate({ stringId, text });
  clearTranslationRef.current = (stringId) => clearMutation.mutate({ stringId });

  const aiVerify = useAiVerify(modId, filter.srcLang, filter.targetLang);
  const aiJobs = useModAiJobsForMod(modId);
  useModAiJobsPoll(true);
  const applyImported = useApplyImported(modId, filter.srcLang, filter.targetLang);

  const batchTranslate = useEditorBatchTranslate({
    modId,
    srcLang: filter.srcLang,
    targetLang: filter.targetLang,
    refetchStats: editorQueries.refetchStats,
    resolveSelectedIds: selection.resolveSelectedIds,
    clearSelection: selection.clearSelection,
    onDraftFilter: () => filter.setSelectedStatuses(['draft']),
  });

  useEditorJobEffects({
    modId,
    srcLang: filter.srcLang,
    targetLang: filter.targetLang,
    refetchStats: editorQueries.refetchStats,
    aiVerify,
    applyImported,
    aiJobs,
    showTranslateResultToast: batchTranslate.showTranslateResultToast,
    setShowAiVerify: modals.setShowAiVerify,
  });

  const contextMenu = useEditorContextMenu({
    modId,
    targetLang: filter.targetLang,
    hasSelection: selection.hasSelection,
    selectedCount: selection.selectedCount,
    selectAllMatching: selection.selectAllMatching,
    selected: selection.selected,
    buildFilter: selection.buildFilter,
    selectedLoadedRows: selection.selectedLoadedRows,
    resolveSelectedIds: selection.resolveSelectedIds,
    isRowSelected: selection.isRowSelected,
    refetchStats: editorQueries.refetchStats,
    clearSelection: selection.clearSelection,
    activeRowRef: row.activeRowRef,
    setActiveRow: row.setActiveRow,
    setDraftTranslation: row.setDraftTranslation,
    handleClear: row.handleClear,
    handleRowSelect: row.handleRowSelect,
  });

  const qaIssueRowCount =
    editorQueries.strings?.rows.filter((r) => r.qa_issue_count > 0).length ?? 0;

  useEditorKeyboard({
    enabled: filter.pageMode === 'strings',
    activeRow: row.activeRow,
    focusedRow: row.focusedRow,
    hasSelection: selection.hasSelection,
    strings: editorQueries.strings,
    ctxMenu: contextMenu.ctxMenu,
    translAreaRef: row.translAreaRef,
    flushAutosave,
    handleSave: row.handleSave,
    handleCopySource: row.handleCopySource,
    handleClear: row.handleClear,
    handleRowOpen: row.handleRowOpen,
    handleRowSelect: row.handleRowSelect,
    handleNextQaIssue: () => row.handleNextQaIssue(editorQueries.strings?.rows ?? []),
    toggleAll: selection.toggleAll,
    clearSelection: selection.clearSelection,
    setActiveRow: row.setActiveRow,
    setDraftTranslation: row.setDraftTranslation,
    setSelected: selection.setSelected,
    setCtxMenu: contextMenu.setCtxMenu,
    setShowShortcuts: modals.setShowShortcuts,
  });

  return {
    modId,
    gameId,
    modals,
    filter,
    editorQueries,
    selection,
    row,
    saveMutation,
    clearSameAsSourceMut,
    saveIndicator,
    aiVerify,
    aiJobs,
    applyImported,
    batchTranslate,
    contextMenu,
    qaIssueRowCount,
  };
}
