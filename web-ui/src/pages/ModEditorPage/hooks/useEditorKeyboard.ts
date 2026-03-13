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
  /** Set of selected string IDs. */
  selected: Set<number>;
  /** Current page of string rows. */
  strings: { rows: StringRow[]; total: number } | undefined;
  /** Context-menu state (truthy = open). */
  ctxMenu: { x: number; y: number; row: StringRow } | null;
  /** Current page number (1-based). */
  page: number;
  /** Number of rows per page. */
  pageSize: number;
  /** Ref to the translation textarea (for Enter-to-focus). */
  translAreaRef: React.RefObject<HTMLTextAreaElement | null>;

  /* ── Action handlers ── */

  flushAutosave: () => void;
  handleSave: () => void;
  handleApprove: (row: StringRow) => void;
  handleReject: (row: StringRow) => void;
  handleCopySource: () => void;
  handleClear: (row: StringRow) => void;
  handleRowClick: (row: StringRow) => void;
  toggleAll: () => void;

  /* ── State setters ── */

  setActiveRow: React.Dispatch<React.SetStateAction<StringRow | null>>;
  setDraftTranslation: React.Dispatch<React.SetStateAction<string>>;
  setSelected: React.Dispatch<React.SetStateAction<Set<number>>>;
  setCtxMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; row: StringRow } | null>>;
  setPage: React.Dispatch<React.SetStateAction<number>>;
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
 * | `Enter`              | Focus translation textarea            |
 * | `Space`              | Toggle selection on active row        |
 * | `Ctrl+A`             | Select / deselect all                 |
 * | `PageDown / PageUp`  | Pagination                            |
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
        if (c.ctxMenu) { c.setCtxMenu(null); return; }
        if (c.activeRow) {
          c.flushAutosave();
          c.setActiveRow(null);
          c.setDraftTranslation('');
        } else if (c.selected.size > 0) {
          c.setSelected(new Set());
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
          c.handleRowClick(c.strings.rows[0]);
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

      /* ── Arrow Up / Down — navigate rows ── */
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && c.strings?.rows.length) {
        e.preventDefault();
        const rows = c.strings.rows;
        const curIdx = c.activeRow
          ? rows.findIndex((r) => r.string_id === c.activeRow!.string_id)
          : -1;
        const nextIdx =
          e.key === 'ArrowDown'
            ? (curIdx < rows.length - 1 ? curIdx + 1 : 0)
            : (curIdx > 0 ? curIdx - 1 : rows.length - 1);
        c.handleRowClick(rows[nextIdx]);
        return;
      }

      /* ── n — next untranslated ── */
      if (e.key === 'n' && !e.ctrlKey && !e.altKey && !e.shiftKey && c.strings?.rows.length) {
        e.preventDefault();
        const rows = c.strings.rows;
        const curIdx = c.activeRow
          ? rows.findIndex((r) => r.string_id === c.activeRow!.string_id)
          : -1;
        for (let i = 1; i <= rows.length; i++) {
          const idx = (curIdx + i) % rows.length;
          if (!rows[idx].translation) {
            c.handleRowClick(rows[idx]);
            break;
          }
        }
        return;
      }

      /* ── Enter — focus translation textarea ── */
      if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.shiftKey && c.activeRow) {
        e.preventDefault();
        c.translAreaRef.current?.focus();
        return;
      }

      /* ── Space — toggle selection on active row ── */
      if (e.key === ' ' && !e.ctrlKey && !e.altKey && !e.shiftKey && c.activeRow) {
        e.preventDefault();
        const rowId = c.activeRow.string_id;
        c.setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(rowId)) next.delete(rowId);
          else next.add(rowId);
          return next;
        });
        return;
      }

      /* ── Ctrl+A — select / deselect all ── */
      if (e.key === 'a' && e.ctrlKey && !e.shiftKey && !e.altKey && c.strings?.rows.length) {
        e.preventDefault();
        c.toggleAll();
        return;
      }

      /* ── PageDown / PageUp — pagination ── */
      if (e.key === 'PageDown' && c.strings) {
        e.preventDefault();
        const totalPages = Math.ceil(c.strings.total / c.pageSize);
        if (c.page < totalPages) c.setPage(c.page + 1);
        return;
      }
      if (e.key === 'PageUp' && c.strings) {
        e.preventDefault();
        if (c.page > 1) c.setPage(c.page - 1);
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
