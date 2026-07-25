import { useState, useRef, useCallback } from 'react';
import type { StringRow } from '../../../api';
import type { BottomTab } from '../components/DetailPanel';
import { useDetailPanelHeight } from './useDetailPanelHeight';

export interface UseEditorActiveRowParams {
  flushAutosave: () => void;
  cancelAutosave: () => void;
  saveTranslation: (stringId: number, text: string) => void;
  clearTranslation: (stringId: number) => void;
}

/**
 * Active detail-panel row, draft translation, and row open/select handlers.
 */
export function useEditorActiveRow({
  flushAutosave,
  cancelAutosave,
  saveTranslation,
  clearTranslation,
}: UseEditorActiveRowParams) {
  const [activeRow, setActiveRow] = useState<StringRow | null>(null);
  const [focusedRow, setFocusedRow] = useState<StringRow | null>(null);
  const [draftTranslation, setDraftTranslation] = useState('');
  const [activeTab, setActiveTab] = useState<BottomTab>('suggestions');
  const activeRowRef = useRef(activeRow);
  activeRowRef.current = activeRow;
  const translAreaRef = useRef<HTMLTextAreaElement>(null);
  const centerColRef = useRef<HTMLDivElement>(null);
  const { detailPanelHeight, isResizing, startDetailPanelResize } =
    useDetailPanelHeight(centerColRef);

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

  const handleCopySource = useCallback(() => {
    if (!activeRow) return;
    setDraftTranslation(activeRow.source);
  }, [activeRow]);

  const handleClear = useCallback(
    (row: StringRow) => {
      clearTranslation(row.string_id);
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
    },
    [activeRow, clearTranslation],
  );

  const handleSave = useCallback(() => {
    cancelAutosave();
    if (!activeRow) return;
    if (draftTranslation.trim() === '') {
      handleClear(activeRow);
      return;
    }
    saveTranslation(activeRow.string_id, draftTranslation);
  }, [cancelAutosave, activeRow, draftTranslation, handleClear, saveTranslation]);

  return {
    activeRow,
    setActiveRow,
    activeRowRef,
    focusedRow,
    draftTranslation,
    setDraftTranslation,
    activeTab,
    setActiveTab,
    translAreaRef,
    centerColRef,
    detailPanelHeight,
    isResizing,
    startDetailPanelResize,
    handleRowSelect,
    handleRowOpen,
    handleCopySource,
    handleClear,
    handleSave,
  };
}
