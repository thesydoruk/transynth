import { useState, useCallback, type RefObject, type Dispatch, type SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type StringFilterParams, type StringRow } from '../../../api';
import type { ContextMenuStatus } from '../statusFilter';
import { useEditorGridCachePatches } from './useEditorGridCachePatches';

const SET_STATUS_CHUNK = 100;
const MARK_SKIP_CHUNK = 100;

export interface UseEditorContextMenuParams {
  modId: number;
  targetLang: string;
  hasSelection: boolean;
  selectedCount: number;
  selectAllMatching: boolean;
  selected: Set<number>;
  buildFilter: () => StringFilterParams;
  selectedLoadedRows: () => StringRow[];
  resolveSelectedIds: () => Promise<number[]>;
  isRowSelected: (id: number) => boolean;
  refetchStats: () => void;
  clearSelection: () => void;
  activeRowRef: RefObject<StringRow | null>;
  setActiveRow: Dispatch<SetStateAction<StringRow | null>>;
  setDraftTranslation: Dispatch<SetStateAction<string>>;
  handleClear: (row: StringRow) => void;
  handleRowSelect: (row: StringRow) => void;
}

/**
 * Right-click context menu state and bulk row actions.
 */
export function useEditorContextMenu({
  modId,
  targetLang,
  hasSelection,
  selectedCount,
  selectAllMatching,
  selected,
  buildFilter,
  selectedLoadedRows,
  resolveSelectedIds,
  isRowSelected,
  refetchStats,
  clearSelection,
  activeRowRef,
  setActiveRow,
  setDraftTranslation,
  handleClear,
  handleRowSelect,
}: UseEditorContextMenuParams) {
  const qc = useQueryClient();
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; row: StringRow } | null>(null);
  const { patchClearedInCache, patchSkipInCache, patchStatusInCache } =
    useEditorGridCachePatches(modId);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, row: StringRow) => {
      e.preventDefault();
      handleRowSelect(row);
      setCtxMenu({ x: e.clientX, y: e.clientY, row });
    },
    [handleRowSelect],
  );

  const ctxMultiTarget = hasSelection;
  const ctxTargetCount = ctxMultiTarget ? selectedCount : 1;

  const applyTextTransform = useCallback(
    async (row: StringRow, transform: (text: string) => string) => {
      const targetRows = hasSelection
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
    [hasSelection, selectedLoadedRows, targetLang, qc, modId, refetchStats],
  );

  const ctxCopySource = useCallback(
    async (row: StringRow) => {
      const targetRows = hasSelection ? selectedLoadedRows() : [row];
      for (const r of targetRows) {
        await api.strings.saveTranslation(r.string_id, r.source, 'draft', targetLang);
      }
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      void refetchStats();
    },
    [hasSelection, selectedLoadedRows, targetLang, qc, modId, refetchStats],
  );

  const ctxSetStatus = useCallback(
    async (row: StringRow, status: ContextMenuStatus) => {
      const applyStatusToActiveRow = (stringId: number) => {
        const activeId = activeRowRef.current?.string_id;
        if (activeId !== stringId) return;
        setActiveRow((prev) => (prev ? { ...prev, status, is_ignored: false } : prev));
      };

      const eligibleLoadedRows = (rows: StringRow[]) =>
        rows.filter((r) => !!r.translation && r.status !== 'skip' && !r.is_ignored);

      if (hasSelection) {
        const loadedTargets = eligibleLoadedRows(selectedLoadedRows());
        patchStatusInCache((r) => loadedTargets.some((t) => t.string_id === r.string_id), status);
        try {
          const ids = await resolveSelectedIds();
          for (let i = 0; i < ids.length; i += SET_STATUS_CHUNK) {
            await api.strings.setStatus(ids.slice(i, i + SET_STATUS_CHUNK), status, targetLang);
          }
          void refetchStats();
          const activeId = activeRowRef.current?.string_id;
          if (activeId && isRowSelected(activeId)) applyStatusToActiveRow(activeId);
        } catch {
          qc.invalidateQueries({ queryKey: ['strings', modId] });
        }
      } else {
        if (!row.translation || row.status === 'skip' || row.is_ignored) return;
        patchStatusInCache((r) => r.string_id === row.string_id, status);
        try {
          await api.strings.setStatus([row.string_id], status, targetLang);
          void refetchStats();
          applyStatusToActiveRow(row.string_id);
        } catch {
          qc.invalidateQueries({ queryKey: ['strings', modId] });
        }
      }
    },
    [
      hasSelection,
      patchStatusInCache,
      selectedLoadedRows,
      resolveSelectedIds,
      isRowSelected,
      refetchStats,
      qc,
      modId,
      targetLang,
      activeRowRef,
      setActiveRow,
    ],
  );

  const ctxSetSkip = useCallback(
    async (row: StringRow, skip: boolean) => {
      const applySkipToActiveRow = (stringId: number) => {
        const activeId = activeRowRef.current?.string_id;
        if (activeId !== stringId) return;
        setActiveRow((prev) =>
          prev
            ? skip
              ? {
                  ...prev,
                  is_ignored: true,
                  status: 'skip',
                  translation: null,
                  translation_id: null,
                  qa_issue_count: 0,
                }
              : { ...prev, is_ignored: false, status: null }
            : prev,
        );
        if (skip) setDraftTranslation('');
      };

      if (hasSelection) {
        patchSkipInCache((r) => isRowSelected(r.string_id), skip);
        try {
          const ids = await resolveSelectedIds();
          for (let i = 0; i < ids.length; i += MARK_SKIP_CHUNK) {
            await api.strings.markSkip(ids.slice(i, i + MARK_SKIP_CHUNK), skip);
          }
          void refetchStats();
          const activeId = activeRowRef.current?.string_id;
          if (activeId && isRowSelected(activeId)) applySkipToActiveRow(activeId);
        } catch {
          qc.invalidateQueries({ queryKey: ['strings', modId] });
        }
      } else {
        patchSkipInCache((r) => r.string_id === row.string_id, skip);
        try {
          await api.strings.markSkip([row.string_id], skip);
          void refetchStats();
          applySkipToActiveRow(row.string_id);
        } catch {
          qc.invalidateQueries({ queryKey: ['strings', modId] });
        }
      }
    },
    [
      hasSelection,
      patchSkipInCache,
      resolveSelectedIds,
      isRowSelected,
      refetchStats,
      qc,
      modId,
      activeRowRef,
      setActiveRow,
      setDraftTranslation,
    ],
  );

  const ctxClear = useCallback(
    async (row: StringRow) => {
      if (hasSelection) {
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
    [
      hasSelection,
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
      activeRowRef,
      setActiveRow,
      setDraftTranslation,
      handleClear,
    ],
  );

  return {
    ctxMenu,
    setCtxMenu,
    handleContextMenu,
    ctxMultiTarget,
    ctxTargetCount,
    applyTextTransform,
    ctxCopySource,
    ctxSetStatus,
    ctxSetSkip,
    ctxClear,
  };
}
