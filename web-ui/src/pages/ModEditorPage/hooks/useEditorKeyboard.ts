import { useRef, useEffect } from 'react';
import type { StringRow } from '../../../api';

/**
 * Complete snapshot of values and callbacks the keyboard-shortcut handler
 * needs access to on every key-press.
 *
 * Stored in a ref so the `keydown` listener is registered only once and
 * never becomes stale — which also eliminates the `exhaustive-deps`
 * warnings that the inline `useEffect` in the component previously had.
 */
export interface EditorKeyboardConfig {
  /* ── State values ── */

  /** Row currently being edited in the detail panel. */
  activeRow: StringRow | null;
  /** Row highlighted in the grid when the detail panel is closed. */
  focusedRow: StringRow | null;
  /** Whether any rows are currently selected (either selection mode). */
  hasSelection: boolean;
  /** Accumulated string rows currently loaded in the grid. */
  strings: { rows: StringRow[]; total: number } | undefined;
  /** Context-menu state (truthy = open). */
  ctxMenu: { x: number; y: number; row: StringRow } | null;
  /** Ref to the translation textarea (for Enter-to-focus). */
  translAreaRef: React.RefObject<HTMLTextAreaElement | null>;

  /* ── Action handlers ── */

  flushAutosave: () => void;
  handleSave: () => void;
  handleApprove: (row: StringRow) => void;
  handleReject: (row: StringRow) => void;
  handleCopySource: () => void;
  handleClear: (row: StringRow) => void;
  handleRowOpen: (row: StringRow) => void;
  /** Move grid focus without opening the detail panel (single click / arrow keys). */
  handleRowSelect: (row: StringRow) => void;
  handleNextQaIssue: () => void;
  toggleAll: () => void;
  /** Clears the current selection (both selection modes). */
  clearSelection: () => void;

  /* ── State setters ── */

  setActiveRow: React.Dispatch<React.SetStateAction<StringRow | null>>;
  setDraftTranslation: React.Dispatch<React.SetStateAction<string>>;
  setSelected: React.Dispatch<React.SetStateAction<Set<number>>>;
  setCtxMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; row: StringRow } | null>>;
  setShowShortcuts: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Registers a global `keydown` listener that implements every keyboard
 * shortcut available in the mod-editor grid.
 *
 * All mutable values are accessed via a ref that is updated on each render,
 * so the event listener is attached exactly **once** and never becomes stale.
 * This eliminates the `react-hooks/exhaustive-deps` warnings that the inline
 * `useEffect` in the component previously had.
 *
 * ### Supported shortcuts
 *
 * | Key                  | Action                                |
 * |----------------------|---------------------------------------|
 * | `Escape`             | Close ctx menu → deselect row → clear |
 * | `Ctrl+S`             | Save                                  |
 * | `Ctrl+Shift+A`       | Approve active row                    |
 * | `Ctrl+Shift+R`       | Reject active row                     |
 * | `Ctrl+Shift+C`       | Copy source to draft                  |
 * | `Ctrl+Shift+X`       | Clear active row                      |
 * | `Ctrl+Shift+E`       | Toggle detail panel                   |
 * | `?`                  | Toggle shortcuts overlay              |
 * | `↑ / ↓`             | Navigate rows                         |
 * | `n`                  | Jump to next untranslated             |
 * | `q`                  | Jump to next QA issue                 |
 * | `Enter`              | Focus translation textarea            |
 * | `Space`              | Toggle selection on active row        |
 * | `Ctrl+A`             | Select / deselect all matching        |
 *
 * @param config - The full snapshot of state and handlers.
 */
export function useEditorKeyboard(config: EditorKeyboardConfig): void {
  const ref = useRef(config);
  ref.current = config;

  useEffect(() => {
    /**
     * Unified keydown handler.  Reads the latest config from `ref.current`
     * so the listener never captures stale closures.
     */
    const onKeyDown = (e: KeyboardEvent) => {
      const c = ref.current;
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

      /* ── Escape ── */
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

      /* ── Ctrl+S — save ── */
      if (e.key === 's' && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        c.handleSave();
        return;
      }

      /* ── Ctrl+Shift+A — approve ── */
      if (e.key === 'A' && e.ctrlKey && e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (
          c.activeRow?.translation_id &&
          c.activeRow.status !== 'reviewed' &&
          c.activeRow.status !== 'human'
        ) {
          c.handleApprove(c.activeRow);
        }
        return;
      }

      /* ── Ctrl+Shift+R — reject ── */
      if (e.key === 'R' && e.ctrlKey && e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (c.activeRow?.translation_id && c.activeRow.status !== 'rejected') {
          c.handleReject(c.activeRow);
        }
        return;
      }

      /* ── Ctrl+Shift+C — copy source ── */
      if (e.key === 'C' && e.ctrlKey && e.shiftKey && !e.altKey) {
        e.preventDefault();
        c.handleCopySource();
        return;
      }

      /* ── Ctrl+Shift+X — clear ── */
      if (e.key === 'X' && e.ctrlKey && e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (c.activeRow) c.handleClear(c.activeRow);
        return;
      }

      /* ── Ctrl+Shift+E — toggle detail panel ── */
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

      /* ── ? — shortcuts overlay ── */
      if (e.key === '?' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        c.setShowShortcuts((v) => !v);
        return;
      }

      /* Below this line: only when focus is NOT in a text input. */
      if (isInput) return;

      /* ── Arrow Up / Down — navigate rows without opening the detail panel ── */
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

      /* ── n — next untranslated ── */
      if (e.key === 'n' && !e.ctrlKey && !e.altKey && !e.shiftKey && c.strings?.rows.length) {
        e.preventDefault();
        const rows = c.strings.rows;
        const current = c.activeRow ?? c.focusedRow;
        const curIdx = current ? rows.findIndex((r) => r.string_id === current.string_id) : -1;
        for (let i = 1; i <= rows.length; i++) {
          const idx = (curIdx + i) % rows.length;
          if (!rows[idx].translation) {
            c.handleRowOpen(rows[idx]);
            break;
          }
        }
        return;
      }

      /* ── q — next QA issue ── */
      if (e.key === 'q' && !e.ctrlKey && !e.altKey && !e.shiftKey && c.strings?.rows.length) {
        e.preventDefault();
        c.handleNextQaIssue();
        return;
      }

      /* ── Enter — open panel or focus translation textarea ── */
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

      /* ── Space — toggle selection on focused / active row ── */
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

      /* ── Ctrl+A — select / deselect all matching ── */
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
