import { useState, type Dispatch, type SetStateAction, type RefObject } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type StringRow } from '../../../api';

/**
 * Parameters accepted by {@link useEditorMutations}.
 */
export interface UseEditorMutationsParams {
  /** Numeric mod identifier. */
  modId: number;
  /** Source language code (used by TM-apply). */
  srcLang: string;
  /** Target language code for all save / review operations. */
  targetLang: string;
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
  /** State setter for the selected-row ID set. */
  setSelected: Dispatch<SetStateAction<Set<number>>>;
}

/**
 * Encapsulates the six `useMutation` calls used by the mod-editor page and
 * the `saveIndicator` state that tracks the visual "saving → saved" cycle.
 *
 * Each mutation's `onSuccess` callback invalidates the relevant query caches
 * and updates the active-row state when appropriate.
 *
 * @param params - IDs, language codes, refs and setters needed by the mutations.
 * @returns Mutation objects and the save-indicator state.
 */
export function useEditorMutations({
  modId, srcLang, targetLang, refetchStats,
  activeRowRef, setActiveRow, setSelected,
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

  /* ── Save translation ── */
  const saveMutation = useMutation({
    mutationFn: ({ stringId, text }: { stringId: number; text: string }) =>
      api.strings.saveTranslation(stringId, text, 'draft', targetLang),
    onMutate: ({ stringId, text }) => {
      /* Optimistic update: patch the cached rows immediately. */
      qc.setQueriesData<{ rows: StringRow[]; total: number }>(
        { queryKey: ['strings', modId] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            rows: old.rows.map((r) =>
              r.string_id === stringId
                ? { ...r, translation: text || null, status: text ? 'draft' : null }
                : r,
            ),
          };
        },
      );
      setSaveIndicator('saving');
    },
    onSuccess: (result) => {
      invalidateAll();
      const current = activeRowRef.current;
      if (current?.string_id === result.id || (current && result.id)) {
        setActiveRow((prev) =>
          prev ? { ...prev, translation: result.text, translation_id: result.id, status: 'draft' } : prev,
        );
      }
      setSaveIndicator('saved');
      setTimeout(() => setSaveIndicator('idle'), 1500);
    },
    onError: () => {
      setSaveIndicator('idle');
    },
  });

  /* ── Approve (review) ── */
  const approveMutation = useMutation({
    mutationFn: ({ stringId, translationId }: { stringId: number; translationId: number }) =>
      api.strings.updateStatus(stringId, translationId, 'reviewed'),
    onSuccess: () => {
      invalidateAll();
      const row = activeRowRef.current;
      if (row) setActiveRow({ ...row, status: 'reviewed' });
    },
  });

  /* ── Reject ── */
  const rejectMutation = useMutation({
    mutationFn: ({ stringId, translationId }: { stringId: number; translationId: number }) =>
      api.strings.updateStatus(stringId, translationId, 'rejected'),
    onSuccess: () => {
      invalidateAll();
      const row = activeRowRef.current;
      if (row) setActiveRow({ ...row, status: 'rejected' });
    },
  });

  /* ── Clear translation ── */
  const clearMutation = useMutation({
    mutationFn: ({ stringId }: { stringId: number }) =>
      api.strings.clearTranslation(stringId, targetLang),
    onSuccess: () => {
      invalidateAll();
      const row = activeRowRef.current;
      if (row) setActiveRow({ ...row, translation: null, status: null });
    },
  });

  /* ── TM auto-apply ── */
  const tmApplyMut = useMutation({
    mutationFn: () => api.mods.tmApply(modId, srcLang, targetLang),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['strings', modId] });
      void refetchStats();
    },
  });

  /* ── Bulk review (approve / reject selected rows) ── */
  const bulkReviewMutation = useMutation({
    mutationFn: ({ ids, status }: { ids: number[]; status: 'reviewed' | 'rejected' }) =>
      api.mods.bulkReview(modId, ids, status, targetLang),
    onSuccess: () => {
      invalidateAll();
      setSelected(new Set());
    },
  });

  return {
    saveMutation,
    approveMutation,
    rejectMutation,
    clearMutation,
    tmApplyMut,
    bulkReviewMutation,
    saveIndicator,
  };
}
