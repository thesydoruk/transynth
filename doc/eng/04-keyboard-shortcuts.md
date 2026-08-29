# 04 — Keyboard Shortcuts

Shortcuts apply when the editor page is focused. Strings grid, Dialogs, and
Voice each own a slightly different set. Most unmodified keys are ignored while
you type in an `input`, `select`, or `textarea`.

There is no `Ctrl+H` for Search & Replace — use the toolbar button.
There is no `Page Up` / `Page Down` paging: the strings grid is infinite scroll.

---

## Table of Contents

- [Strings grid](#strings-grid)
- [Dialogs](#dialogs)
- [Voice](#voice)
- [Book / HTML modal](#book--html-modal)

---

## Strings grid

| Shortcut       | Action                                                                         |
| -------------- | ------------------------------------------------------------------------------ |
| `Ctrl+S`       | Save the current translation                                                   |
| `Ctrl+Enter`   | Save from the Detail Panel textarea                                            |
| `Enter`        | Open the Detail Panel, or focus the translation textarea if it is already open |
| `Escape`       | Close the context menu, close the Detail Panel, or clear selection             |
| `?`            | Toggle the shortcuts overlay                                                   |
| `↑` / `↓`      | Move the focused row; wraps at the ends of the **loaded** list                 |
| `Ctrl+Shift+E` | Toggle the Detail Panel (reopens on the focused or first loaded row)           |
| `Ctrl+Shift+C` | Copy source into the translation field                                         |
| `Ctrl+Shift+X` | Clear the current translation                                                  |
| `Space`        | Toggle selection for the focused row                                           |
| `Ctrl+A`       | Select or clear **all rows matching the filter** (not only the visible page)   |

`Ctrl+Shift+C` does not apply a TM suggestion. `Ctrl+Shift+X` does not call the LLM.

`N` is **not** bound in the strings grid. Use it in Dialogs and Voice.

If the browser intercepts `Ctrl+S`, use a clean profile or disable the conflicting extension.

---

## Dialogs

Active on the Dialogs tab (Bethesda). Modifier chords stay live while editing;
plain keys are ignored while the caret is in a field.

| Shortcut              | Action                                         |
| --------------------- | ---------------------------------------------- |
| `1` / `2` / `3` / `4` | Scope: topics, branches, scenes, conversations |
| `Alt+↑` / `Alt+↓`     | Previous / next group in the navigator         |
| `↑` / `↓`             | Previous / next line in the transcript         |
| `/`                   | Focus find                                     |
| `N`                   | Next unfinished line                           |
| `P`                   | Play the focused line’s voice-over, if any     |
| `Enter`               | Edit the focused line                          |
| `Escape`              | Clear focus (when not editing)                 |

---

## Voice

Same line-list keys as Dialogs (`↑`/`↓`, `N`, `P`, `Enter`, `Escape`). There is
no scope switch and no `Alt+↑`/`Alt+↓` group step. See [Voice](09-voice.md).

---

## Book / HTML modal

`Escape` closes. `Ctrl+Enter` saves.

---

← [The Editor](03-editor.md) | [Home](README.md) | **Next: [Translation Memory →](05-translation-memory.md)**
