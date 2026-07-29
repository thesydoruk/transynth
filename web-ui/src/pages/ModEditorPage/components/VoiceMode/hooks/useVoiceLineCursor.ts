import { useCallback, useEffect, useState } from 'react';
import type { VoiceLinePreview } from '../../../../../api';
import { isEditableVoiceLine } from './useVoiceLineView';

const isUntranslated = (line: VoiceLinePreview): boolean =>
  isEditableVoiceLine(line) && !line.translation?.trim();

/** Keyboard cursor over editable voice lines, keyed by `stringId`. */
export const useVoiceLineCursor = (lineIds: number[], lineById: Map<number, VoiceLinePreview>) => {
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

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

  const goToNextTodo = useCallback(
    (keepEditing = false) => {
      if (lineIds.length === 0) return;
      for (let offset = 1; offset <= lineIds.length; offset++) {
        const index = (focusIndex + offset + lineIds.length) % lineIds.length;
        const line = lineById.get(lineIds[index]!);
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

export type VoiceLineCursor = ReturnType<typeof useVoiceLineCursor>;
