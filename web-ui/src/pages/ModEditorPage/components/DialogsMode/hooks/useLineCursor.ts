import { useCallback, useEffect, useState } from 'react';
import { isUntranslated, type TranscriptView } from './useTranscriptView';

/**
 * Keyboard cursor over the visible transcript lines.
 *
 * One line is focused at a time and at most one is open for editing. Moving
 * while an editor is open carries the editor along, which is what makes
 * "save and continue" feel like typing down a list instead of clicking cells.
 */
export const useLineCursor = (view: TranscriptView) => {
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { lineIds, lineById } = view;

  useEffect(() => {
    if (focusedId !== null && !lineById.has(focusedId)) {
      setFocusedId(null);
      setEditingId(null);
    }
  }, [lineById, focusedId]);

  const focusIndex = focusedId === null ? -1 : lineIds.indexOf(focusedId);

  const goTo = useCallback(
    (index: number, keepEditing: boolean) => {
      const id = lineIds[index];
      if (id === undefined) return;
      setFocusedId(id);
      setEditingId(keepEditing ? id : null);
    },
    [lineIds],
  );

  const step = useCallback(
    (delta: number, keepEditing = false) => {
      if (lineIds.length === 0) return;
      const next = focusIndex < 0 ? (delta > 0 ? 0 : lineIds.length - 1) : focusIndex + delta;
      if (next < 0 || next >= lineIds.length) return;
      goTo(next, keepEditing);
    },
    [focusIndex, goTo, lineIds.length],
  );

  /** Jump to the next line without a translation, wrapping around the end. */
  const goToNextTodo = useCallback(
    (keepEditing = false) => {
      if (lineIds.length === 0) return;
      for (let offset = 1; offset <= lineIds.length; offset++) {
        const index = (focusIndex + offset + lineIds.length) % lineIds.length;
        const line = lineById.get(lineIds[index]);
        if (line && isUntranslated(line)) {
          goTo(index, keepEditing);
          return;
        }
      }
    },
    [focusIndex, goTo, lineById, lineIds],
  );

  const edit = useCallback(
    (id?: number) => {
      const target = id ?? focusedId ?? lineIds[0];
      if (target === undefined) return;
      setFocusedId(target);
      setEditingId(target);
    },
    [focusedId, lineIds],
  );

  const closeEditor = useCallback(() => setEditingId(null), []);

  return {
    focusedId,
    editingId,
    focus: setFocusedId,
    step,
    goToNextTodo,
    edit,
    closeEditor,
    hasLines: lineIds.length > 0,
  };
};

/** Return type of {@link useLineCursor}. */
export type LineCursor = ReturnType<typeof useLineCursor>;
