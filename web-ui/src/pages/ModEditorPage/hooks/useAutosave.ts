import { useRef, useEffect, useCallback } from 'react';
import type { StringRow } from '../../../api';

/**
 * Parameters accepted by {@link useAutosave}.
 */
export interface UseAutosaveParams {
  /** Currently active (detail-panel) row, or `null` when none is selected. */
  activeRow: StringRow | null;
  /** Working copy of the translation text in the textarea. */
  draftTranslation: string;
  /**
   * Callback to persist a non-empty translation.
   * Receives the `string_id` and the draft text.
   */
  onSave: (stringId: number, text: string) => void;
  /**
   * Callback to clear a translation (when the draft is blank).
   * Receives the `string_id`.
   */
  onClear: (stringId: number) => void;
}

/**
 * Manages debounced autosave for the translation editor.
 *
 * When the user is typing and pauses for 800 ms, the hook automatically
 * persists the draft via `onSave` (or clears the translation via `onClear` if
 * the text is blank).
 *
 * ### Returned helpers
 *
 * - **`flushAutosave()`** — immediately persists any pending change (e.g.
 *   before navigating away from the active row).
 * - **`cancelAutosave()`** — discards the pending timer without saving (e.g.
 *   when the caller handles the save itself via Ctrl+S).
 *
 * Both functions are referentially stable (wrapped in `useCallback` with no
 * external dependencies) so they are safe to use in other `useCallback` /
 * `useEffect` dependency arrays.
 *
 * @param params - Active row, draft text, and save/clear callbacks.
 * @returns `flushAutosave` and `cancelAutosave` helpers.
 */
export function useAutosave({ activeRow, draftTranslation, onSave, onClear }: UseAutosaveParams) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * Refs keep the latest values accessible from the stable callbacks below
   * without forcing them to re-create on every render.
   */
  const rowRef = useRef(activeRow);
  const draftRef = useRef(draftTranslation);
  const saveRef = useRef(onSave);
  const clearRef = useRef(onClear);
  rowRef.current = activeRow;
  draftRef.current = draftTranslation;
  saveRef.current = onSave;
  clearRef.current = onClear;

  /**
   * Cancels any pending autosave timer without triggering a save.
   * Useful when the caller handles the save itself (e.g. Ctrl+S).
   */
  const cancelAutosave = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  /**
   * Immediately persists the current draft if it differs from the active
   * row's stored translation.  Clears the pending timer first.
   */
  const flushAutosave = useCallback(() => {
    cancelAutosave();
    const row = rowRef.current;
    const text = draftRef.current;
    if (!row) return;
    const original = row.translation ?? '';
    if (text === original) return;
    if (text.trim() === '') clearRef.current(row.string_id);
    else saveRef.current(row.string_id, text);
  }, [cancelAutosave]);

  /*
   * 800 ms debounce timer — restarts whenever `draftTranslation` changes and
   * the text differs from the active row's saved translation.
   */
  useEffect(() => {
    if (!activeRow) return;
    const original = activeRow.translation ?? '';
    if (draftTranslation === original) return;

    cancelAutosave();
    timer.current = setTimeout(() => {
      timer.current = null;
      const row = rowRef.current;
      const text = draftRef.current;
      if (!row) return;
      if (text.trim() === '') clearRef.current(row.string_id);
      else saveRef.current(row.string_id, text);
    }, 800);

    return () => cancelAutosave();
  }, [activeRow, draftTranslation, cancelAutosave]);

  return { flushAutosave, cancelAutosave };
}
