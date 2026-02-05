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

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save the current translation |
| `Enter` | Confirm inline edit / move to next row |
| `Escape` | Cancel inline edit |
| `Ctrl+H` | Open Search & Replace dialog |

> TODO: Verify and complete the full list from implementation.
> Check `web-ui/src/pages/ModEditorPage.tsx` for all `useEffect` / `onKeyDown` handlers.

---

## Navigation Shortcuts

| Shortcut | Action |
|----------|--------|
| `↑` / `↓` | Move selection up / down one row |
| `Page Up` / `Page Down` | Move to previous / next page |
| `N` | Jump to next empty (untranslated) string |

> TODO: Verify N shortcut exists. Check all navigation bindings.

---

## Status Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+A` | Approve selected string(s) |
| `Ctrl+Shift+R` | Reset selected string(s) to Empty |
| `Ctrl+Shift+C` | Apply TM suggestion to selected string(s) |
| `Ctrl+Shift+X` | Trigger LLM translation on selected string(s) |
| `Ctrl+Shift+E` | Open EDID / record in ESP Explorer |
| `Space` | Toggle approval status of selected string |

> TODO: Verify each shortcut from the source code.
> Add any additional shortcuts (Ctrl+D for Draft, etc.).

---

## Tips for Using Shortcuts

- **Most shortcuts work on the current selection.** If you have multiple rows
  selected (e.g. via checkboxes), batch shortcuts apply to all of them.
- **Ctrl+S** saves immediately without leaving the field — useful after voice
  typing or pasting from an external source.
- If a shortcut doesn't fire, click anywhere in the editor grid first to ensure
  the page has keyboard focus.

> TODO: Add note about shortcut conflicts with browser extensions (e.g. Ctrl+S
> in some browsers opens Save dialog). Recommend Firefox or Chrome with minimal
> extensions for best experience.

---

← [The Editor](03-editor.md) | [Home](README.md) | **Next: [Translation Memory →](05-translation-memory.md)**
