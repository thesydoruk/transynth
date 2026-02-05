# 03 — The Editor

The editor is the main workspace for reviewing, correcting, and completing translations.

---

## Table of Contents

- [Opening the Editor](#opening-the-editor)
- [The String Grid](#the-string-grid)
  - [Columns](#columns)
  - [Pagination](#pagination)
  - [Sorting](#sorting)
- [Filter Row](#filter-row)
- [Selecting and Editing Rows](#selecting-and-editing-rows)
- [The Detail Panel](#the-detail-panel)
  - [Source and Translation Text Areas](#source-and-translation-text-areas)
  - [TM Suggestions Tab](#tm-suggestions-tab)
  - [QA Issues Tab](#qa-issues-tab)
  - [Revision History Tab](#revision-history-tab)
- [Status Badges](#status-badges)
- [Batch Actions](#batch-actions)
- [Search and Replace](#search-and-replace)
- [Context Menu](#context-menu)

---

## Opening the Editor

From the **Mods** page (`/`), click the name of a mod to open its editor.
The editor URL is `/mods/:id`.

> TODO: Screenshot of the Mods list page with click target highlighted.

---

## The String Grid

The grid lists all translatable strings in the mod — one row per string.
By default, 100 rows are shown per page.

### Columns

| Column | Description |
|--------|-------------|
| **GRUP** | Record type signature (e.g. `DIAL`, `BOOK`, `NPC_`, `QUST`) |
| **FormID** | Unique hexadecimal record identifier |
| **EDID** | Editor ID — the author's internal name for the record |
| **Field** | Sub-record field name (e.g. `FULL`, `DESC`, `NNAM`) |
| **Source** | Original English (or base-language) text |
| **Translation** | Your translation — editable inline |
| **Status** | Current string status (badge) |

### Pagination

> TODO: Describe the pagination controls (page size selector, previous/next buttons, total count).

### Sorting

> TODO: Describe click-to-sort on column headers. Mention default sort order.

---

## Filter Row

Directly below the column headers is a filter row.
Each input filters the corresponding column as you type.

| Filter | Behaviour |
|--------|-----------|
| GRUP | Exact match (e.g. type `DIAL` to show only dialogue) |
| FormID | Prefix match on hex string |
| EDID | Case-insensitive substring match |
| Field | Substring match |
| Source | Full-text search (PostgreSQL GIN index) |
| Translation | Substring match |

> TODO: Explain the Status dropdown filter (All / Empty / Draft / Approved / TM / Auto).
> Screenshot placeholder.

---

## Selecting and Editing Rows

- **Click** a row to select it and open the Detail Panel.
- **Double-click** the Translation cell to begin inline editing.
- Press **Enter** to confirm, **Escape** to cancel.

> TODO: Describe inline edit behaviour in more detail.
> Explain auto-save (saves on blur / Enter).

---

## The Detail Panel

When a row is selected, the Detail Panel appears at the bottom of the page.
It shows full text (useful for long strings) and three tabs.

### Source and Translation Text Areas

- **Source** — read-only, shows the original text.
- **Translation** — editable multi-line field.

Press **Ctrl+S** to save the current translation.

> TODO: Describe character counter and max-length warning.
> Mention placeholder highlighting (tokens like `<Alias=Player>`).

### TM Suggestions Tab

Shows up to 5 suggestions from the Translation Memory, ranked by match score.
Click a suggestion to copy it into the translation field.

> TODO: Describe the match score display, method badge (anchor / edid / fuzzy etc.).
> Link to [Translation Memory](05-translation-memory.md).

### QA Issues Tab

Shows any QA violations for the current string.
Each issue has a severity (error / warning / info) and a description.

> TODO: List issue type examples with descriptions.
> Link to [Quality Assurance](07-qa.md).

### Revision History Tab

Shows all previous translations for this string, with timestamps and authors.

> TODO: Describe the history list. Mention one-click restore.

---

## Status Badges

Every string has a status that describes its translation state:

| Status | Meaning |
|--------|---------|
| **Empty** | No translation yet |
| **Draft** | Human-entered translation, not yet reviewed |
| **Approved** | Reviewed and confirmed by a translator or reviewer |
| **TM** | Filled automatically by the Translation Memory |
| **Auto** | Filled automatically by LLM translation |

> TODO: Explain how to change status (keyboard, context menu, batch action).
> Explain the colour coding of each badge.

---

## Batch Actions

You can select multiple rows and apply actions to all of them at once.

> TODO: Describe row selection (checkboxes or Shift+Click).
> List available batch actions:
> - Change status (Approve all, Reset all, etc.)
> - Trigger LLM translation on selection
> - Copy TM match to all selected

---

## Search and Replace

Use **Ctrl+H** (or the Search & Replace toolbar button) to open the
Search and Replace dialog.

> TODO: Describe the Search & Replace dialog:
> - Search pattern (plain text or regex)
> - Replace string
> - Scope: current mod / current filter / all mods
> - Dry-run mode (shows preview without saving)
> - Apply button + result count

---

## Context Menu

Right-click any row to open the context menu.

> TODO: List context menu items with descriptions.
> Examples: "Apply TM", "Copy FormID", "Open in INNR editor", "Mark as Approved",
> "Reset to Empty".

---

← [Importing Mods](02-importing-mods.md) | [Home](README.md) | **Next: [Keyboard Shortcuts →](04-keyboard-shortcuts.md)**
