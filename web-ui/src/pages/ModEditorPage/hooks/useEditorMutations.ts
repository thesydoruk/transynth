import { useState, type Dispatch, type SetStateAction, type RefObject } from 'react';
import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { api, type StringRow, type StringsResult } from '../../../api';

/**
 * Parameters accepted by {@link useEditorMutations}.
 */
export interface UseEditorMutationsParams {
  /** Numeric mod identifier. */
  modId: number;
  /** Target language code for all save operations. */
  targetLang: string;
  /** Source language code (used by TM-apply). */
  srcLang: string;
  /** Callback to re-fetch the stats query after a mutation succeeds. */
  refetchStats: () => void;
  /**
   * Ref that always points to the current active row.
   * Using a ref instead of a plain value avoids stale-closure issues
   * inside mutation `onSuccess` callbacks.
   */
  activeRowRef: RefObject<StringRow | null>;
  /** State setter for the active (detail-panel) row. */
  setActiveRow: Dispatch<SetStateAction<StringRow | null>>;
}

/**
 * Encapsulates the mod-editor mutations and the save-indicator state.
 */
export function useEditorMutations({
  modId,
  srcLang,
  targetLang,
  refetchStats,
  activeRowRef,
  setActiveRow,
}: UseEditorMutationsParams) {
  const qc = useQueryClient();

  /** Visual indicator for the save button: idle → saving → saved → idle. */
  const [saveIndicator, setSaveIndicator] = useState<'idle' | 'saving' | 'saved'>('idle');

  /**
   * Invalidates string / history / QA caches and re-fetches stats.
   * Shared by most mutation `onSuccess` handlers.
   */
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['strings', modId] });
    qc.invalidateQueries({ queryKey: ['history'] });
    qc.invalidateQueries({ queryKey: ['qa'] });
    void refetchStats();
  };

  const saveMutation = useMutation({
    mutationFn: ({ stringId, text }: { stringId: number; text: string }) =>
      api.strings.saveTranslation(stringId, text, 'draft', targetLang),
    onMutate: ({ stringId, text }) => {
      qc.setQueriesData<InfiniteData<StringsResult>>({ queryKey: ['strings', modId] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            rows: page.rows.map((r) =>
              r.string_id === stringId
                ? { ...r, translation: text || null, status: text ? 'draft' : null }
                : r,
            ),
          })),
        };
      });
      setSaveIndicator('saving');
    },
    onSuccess: (result) => {
      invalidateAll();
      const current = activeRowRef.current;
      if (current?.string_id === result.id || (current && result.id)) {
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

  const clearMutation = useMutation({
    mutationFn: ({ stringId }: { stringId: number }) =>
      api.strings.clearTranslation(stringId, targetLang),
    onSuccess: () => {
      invalidateAll();
      const row = activeRowRef.current;
      if (row) setActiveRow({ ...row, translation: null, status: null });
    },
  });

  const tmApplyMut = useMutation({
    mutationFn: () => api.mods.tmApply(modId, srcLang, targetLang),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      void refetchStats();
    },
  });

  return {
    saveMutation,
    clearMutation,
    tmApplyMut,
    saveIndicator,
  };
}
