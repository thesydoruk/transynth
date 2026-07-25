import { useRef, useEffect } from 'react';
import type { StringRow } from '../../../api';

/**
 * Complete snapshot of values and callbacks the keyboard-shortcut handler
 * needs access to on every key-press.
 */
export interface EditorKeyboardConfig {
  /** False while another surface owns the keyboard, e.g. the dialogs editor. */
  enabled: boolean;
  activeRow: StringRow | null;
  focusedRow: StringRow | null;
  hasSelection: boolean;
  strings: { rows: StringRow[]; total: number } | undefined;
  ctxMenu: { x: number; y: number; row: StringRow } | null;
  translAreaRef: React.RefObject<HTMLTextAreaElement | null>;

  flushAutosave: () => void;
  handleSave: () => void;
  handleCopySource: () => void;
  handleClear: (row: StringRow) => void;
  handleRowOpen: (row: StringRow) => void;
  handleRowSelect: (row: StringRow) => void;
  handleNextQaIssue: () => void;
  toggleAll: () => void;
  clearSelection: () => void;

  setActiveRow: React.Dispatch<React.SetStateAction<StringRow | null>>;
  setDraftTranslation: React.Dispatch<React.SetStateAction<string>>;
  setSelected: React.Dispatch<React.SetStateAction<Set<number>>>;
  setCtxMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; row: StringRow } | null>>;
  setShowShortcuts: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Registers a global `keydown` listener for mod-editor keyboard shortcuts.
 */
export function useEditorKeyboard(config: EditorKeyboardConfig): void {
  const ref = useRef(config);
  ref.current = config;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const c = ref.current;
      if (!c.enabled) return;
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

      if (e.key === 'Escape') {
        e.preventDefault();
        if (c.ctxMenu) {
          c.setCtxMenu(null);
          return;
        }
        if (c.activeRow) {
          c.flushAutosave();
          c.setActiveRow(null);
          c.setDraftTranslation('');
        } else if (c.hasSelection) {
          c.clearSelection();
        }
        return;
      }

      if (e.key === 's' && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        c.handleSave();
        return;
      }

      if (e.key === 'C' && e.ctrlKey && e.shiftKey && !e.altKey) {
        e.preventDefault();
        c.handleCopySource();
        return;
      }

      if (e.key === 'X' && e.ctrlKey && e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (c.activeRow) c.handleClear(c.activeRow);
        return;
      }

      if (e.key === 'E' && e.ctrlKey && e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (c.activeRow) {
          c.flushAutosave();
          c.setActiveRow(null);
          c.setDraftTranslation('');
        } else if (c.strings?.rows.length) {
          c.handleRowOpen(c.focusedRow ?? c.strings.rows[0]);
        }
        return;
      }

      if (e.key === '?' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        c.setShowShortcuts((v) => !v);
        return;
      }

      if (isInput) return;

      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && c.strings?.rows.length) {
        e.preventDefault();
        const rows = c.strings.rows;
        const current = c.activeRow ?? c.focusedRow;
        const curIdx = current ? rows.findIndex((r) => r.string_id === current.string_id) : -1;
        const nextIdx =
          e.key === 'ArrowDown'
            ? curIdx < rows.length - 1
              ? curIdx + 1
              : 0
            : curIdx > 0
              ? curIdx - 1
              : rows.length - 1;
        c.handleRowSelect(rows[nextIdx]);
        return;
      }

      if (e.key === 'q' && !e.ctrlKey && !e.altKey && !e.shiftKey && c.strings?.rows.length) {
        e.preventDefault();
        c.handleNextQaIssue();
        return;
      }

      if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (c.activeRow) {
          e.preventDefault();
          c.translAreaRef.current?.focus();
        } else if (c.focusedRow) {
          e.preventDefault();
          c.handleRowOpen(c.focusedRow);
        }
        return;
      }

      if (e.key === ' ' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const row = c.activeRow ?? c.focusedRow;
        if (!row) return;
        e.preventDefault();
        const rowId = row.string_id;
        c.setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(rowId)) next.delete(rowId);
          else next.add(rowId);
          return next;
        });
        return;
      }

      if (e.key === 'a' && e.ctrlKey && !e.shiftKey && !e.altKey && c.strings?.rows.length) {
        e.preventDefault();
        c.toggleAll();
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
