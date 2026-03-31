# 04 — Keyboard Shortcuts

Work faster in the editor using keyboard shortcuts.
All shortcuts are active when the editor page is focused.

---

## Table of Contents

- [Editor Shortcuts](#editor-shortcuts)
- [Navigation Shortcuts](#navigation-shortcuts)
- [Status Shortcuts](#status-shortcuts)
- [Tips for Using Shortcuts](#tips-for-using-shortcuts)

---

## Editor Shortcuts

| Shortcut     | Action                                                             |
| ------------ | ------------------------------------------------------------------ |
| `Ctrl+S`     | Save the current translation                                       |
| `Ctrl+Enter` | Save from the translation textarea in the Detail Panel             |
| `Enter`      | Focus the translation textarea for the active row                  |
| `Escape`     | Close the context menu, close the Detail Panel, or clear selection |
| `?`          | Toggle the keyboard shortcuts help overlay                         |

Important corrections:

- The current editor does **not** use inline grid-cell editing, so `Enter` does not confirm an inline edit.
- The current editor does **not** define a `Ctrl+H` shortcut for Search & Replace.
- Search & Replace is opened from the toolbar button instead.

---

## Navigation Shortcuts

| Shortcut                | Action                                   |
| ----------------------- | ---------------------------------------- |
| `↑` / `↓`               | Move selection up / down one row         |
| `Page Up` / `Page Down` | Move to previous / next page             |
| `N`                     | Jump to next empty (untranslated) string |
| `Ctrl+Shift+E`          | Toggle the Detail Panel open or closed   |

Navigation details:

- Arrow-key navigation wraps around at the top and bottom of the current page.
- `N` searches forward from the current row and wraps around until it finds the next row with no translation.
- `Page Up` and `Page Down` switch pages without changing the page size, which is fixed at 100 rows.
- If the Detail Panel is closed, `Ctrl+Shift+E` reopens it on the first visible row of the current page.

---

## Status Shortcuts

| Shortcut       | Action                                          |
| -------------- | ----------------------------------------------- |
| `Ctrl+Shift+A` | Approve the active row                          |
| `Ctrl+Shift+R` | Reject the active row                           |
| `Ctrl+Shift+C` | Copy the source text into the translation field |
| `Ctrl+Shift+X` | Clear the current translation                   |
| `Space`        | Toggle selection for the active row             |
| `Ctrl+A`       | Select or deselect all rows on the current page |

Important corrections:

- `Ctrl+Shift+R` rejects the active translation; it does **not** reset the row to empty.
- `Ctrl+Shift+C` copies source text; it does **not** apply a TM suggestion.
- `Ctrl+Shift+X` clears the translation; it does **not** trigger LLM translation.
- `Ctrl+Shift+E` toggles the Detail Panel; it does **not** open ESP Explorer.
- `Space` toggles row selection; it does **not** toggle approval state.

Current limitation:

- The built-in keyboard handlers operate on the **active row**, not on the whole multi-selection, for approve/reject/copy/clear.
- Bulk operations for multiple selected rows are available through toolbar buttons and the context menu, not through separate keyboard shortcuts.

There are no documented shortcuts such as `Ctrl+D` for Draft or a direct keyboard shortcut for opening Search & Replace.

---

## Tips for Using Shortcuts

- **Most shortcuts work on the current selection.** If you have multiple rows
  selected (e.g. via checkboxes), batch shortcuts apply to all of them.
- **Ctrl+S** saves immediately without leaving the field — useful after voice
  typing or pasting from an external source.
- If a shortcut doesn't fire, click anywhere in the editor grid first to ensure
  the page has keyboard focus.

Clarifications for the current implementation:

- Global keyboard handlers ignore most shortcuts while you are typing in an `input`, `select`, or `textarea`, except for actions intentionally allowed there such as `Escape`, `Ctrl+S`, and the `Ctrl+Shift+...` actions.
- Multi-row batch actions are primarily exposed in the toolbar and context menu. Keyboard shortcuts such as `Ctrl+Shift+A` still act on the active row.
- If browser extensions or the browser itself intercept a shortcut like `Ctrl+S`, use a clean browser profile or disable conflicting extensions for the app.

Modal-specific note:

- The **Book / HTML Editor** modal also supports `Escape` to close and `Ctrl+Enter` to save.

---

← [The Editor](03-editor.md) | [Home](README.md) | **Next: [Translation Memory →](05-translation-memory.md)**
