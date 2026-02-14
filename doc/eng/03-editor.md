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
  - [Status State Machine](#status-state-machine)
- [Batch Actions](#batch-actions)
- [Search and Replace](#search-and-replace)
- [Context Menu](#context-menu)

---

## Opening the Editor

From the **Mods** page (`/`), click the name of a mod to open its editor.
The editor URL is `/mods/:id`.

If you are updating an existing mod version, the editor also exposes an **Update** button.
That uploads a newer plugin or archive and redirects you into the diff workflow once the new import is ready.

---

## The String Grid

The grid lists all translatable strings in the mod — one row per string.
By default, 100 rows are shown per page.

### Columns

| Column          | Description                                                                      |
| --------------- | -------------------------------------------------------------------------------- |
| **Select**      | Checkbox for bulk operations on the current page                                 |
| **GRUP**        | Record type signature (e.g. `DIAL`, `BOOK`, `NPC_`, `QUST`)                      |
| **FormID**      | Unique hexadecimal record identifier                                             |
| **EDID**        | Editor ID — the author's internal name for the record                            |
| **Field**       | Sub-record field name (e.g. `FULL`, `DESC`, `NNAM`)                              |
| **Source**      | Original English (or base-language) text                                         |
| **Translation** | Current best translation, plus a small QA count hint when issues exist           |
| **Actions**     | Quick actions: approve, reject, clear, copy source, and the current status badge |

### Pagination

Pagination is fixed to **100 rows per page** in the current implementation.

At the bottom of the grid you get:

- **Previous** button
- **Next** button
- a page label in the format `Page X / Y (N rows)`

There is currently **no page size selector** in the UI.

Keyboard shortcuts:

- **PgDn** moves to the next page
- **PgUp** moves to the previous page

### Sorting

The following headers are sortable:

- `GRUP`
- `FormID`
- `EDID`
- `Field`
- `Source`
- `Translation`

Clicking the same column cycles through:

1. ascending
2. descending
3. unsorted

When no explicit sort is active, the server falls back to ordering by record signature and path.

The checkbox and Actions columns are not sortable.

You can also resize all data columns by dragging the resize handle in the header.

---

## Filter Row

Directly below the column headers is a filter row.
Each input filters the corresponding column as you type.

| Filter      | Behaviour                                                |
| ----------- | -------------------------------------------------------- |
| GRUP        | Case-insensitive substring match                         |
| FormID      | Case-insensitive substring match                         |
| EDID        | Case-insensitive substring match                         |
| Field       | Case-insensitive substring match against the record path |
| Source      | Case-insensitive substring match                         |
| Translation | Case-insensitive substring match                         |

Above the grid, the toolbar also provides higher-level filters:

- **Source language** selector
- **Target language** selector
- **Status** dropdown
- **Global search** field (`FormID / EDID / text…`)

The status dropdown currently supports:

- `All statuses`
- `Untranslated`
- `Draft`
- `Reviewed`
- `Rejected`
- `Fuzzy`
- `Auto`
- `TM`
- `Human`

The global search field matches against source text, `FormID`, and `EDID`.

There is also a left-side signature panel.
Clicking a signature there filters the grid to that exact record type.

---

## Selecting and Editing Rows

- **Click** a row to select it and open the Detail Panel.
- **Click** the row checkbox to add or remove that row from the bulk selection.
- **Space** toggles selection for the active row.
- **Ctrl+A** selects or deselects all rows on the current page.

Important correction: the current editor does **not** support inline editing directly inside the grid cell.
Editing happens in the Detail Panel.

Save behavior in the current implementation:

- Editing the translation field starts an **800 ms autosave timer**.
- Switching to another row flushes any pending autosave immediately.
- **Ctrl+S** saves manually.
- **Ctrl+Enter** also saves from the translation textarea.
- Clearing the translation field and saving removes the translation, returning the row to the untranslated state.

Press **Escape** to close the context menu, close the detail panel, or clear selection depending on what is currently open.

---

## The Detail Panel

When a row is selected, the Detail Panel appears at the bottom of the page.
It shows full text (useful for long strings) and three tabs.

### Source and Translation Text Areas

- **Source** — read-only, shows the original text.
- **Translation** — editable multi-line field.

Press **Ctrl+S** to save the current translation.

The panel also shows:

- a character counter for the source text
- a character counter for the current translation draft
- quick buttons for **Copy src**, **Review**, **Reject**, and **Save**

If the record is a `BOOK` or the source contains HTML-like markup, the panel shows a **Book / HTML editor** button.
That opens a split-pane modal with raw markup on one side and a live preview on the other.

The current editor does **not** show a dedicated max-length warning in this panel.
It also does **not** visually highlight placeholders inline inside the textarea, although placeholder mismatches are checked by QA.

### TM Suggestions Tab

The Suggestions tab shows up to **10** Translation Memory suggestions.

Each suggestion row includes:

- the translation's current status badge
- a match method badge
- the suggestion text
- a similarity percentage
- an **Apply** button

Current match methods in the UI are:

- `exact`
- `punct_norm`
- `fuzzy`
- `segment`

Clicking **Apply** copies that suggestion into the draft translation field.
It does not save immediately; the normal autosave/manual-save logic still applies.

See [Translation Memory](05-translation-memory.md) for the broader TM workflow.

### QA Issues Tab

Shows any QA violations for the current string.
Each issue has a severity and a message.

The current editor uses **error** and **warning** severities.
There is no separate `info` severity in the QA panel today.

Examples of QA checks currently generated by the backend:

- **empty_translation**: the translation is empty
- **placeholder_mismatch**: placeholder tokens differ between source and translation
- **same_as_source**: translation text is identical to the source
- **length_delta**: translation length differs too much from the source
- **forbidden_chars**: translation contains forbidden control characters or configured forbidden characters
- **max_length**: translation exceeds a configured maximum length for that record type or path
- **glossary_violation**: source contains a glossary term but the required translation is missing
- **duplicate_inconsistency**: the same normalized source text is translated differently elsewhere

See [Quality Assurance](07-qa.md) for the broader QA system and rule configuration.

### Revision History Tab

The History tab shows the revision log for the current string.

Each row includes:

- a status badge
- timestamp
- optional note
- the saved text snapshot

This history is populated for saves, status changes, and clears.

The current UI does **not** show author names in the history list.
It also does **not** offer a one-click restore button from history.

---

## Status Badges

Every string has a status that describes its translation state:

| Status                 | Meaning                                                       |
| ---------------------- | ------------------------------------------------------------- |
| **Untranslated**       | No translation exists yet                                     |
| **Draft**              | Human-entered translation, not yet reviewed                   |
| **Reviewed**           | Manually reviewed and confirmed in the editor                 |
| **Approved** (`human`) | Imported or otherwise marked as a confirmed human translation |
| **TM**                 | Filled automatically from Translation Memory                  |
| **Fuzzy**              | Filled from a fuzzy TM-style match                            |
| **Auto**               | Filled automatically by LLM translation                       |
| **Rejected**           | Explicitly marked as rejected                                 |

How statuses change today:

- Saving a typed translation creates or updates a **Draft** translation.
- **Review / Approve** actions mark it as `reviewed`.
- **Reject** marks it as `rejected`.
- **Apply TM** creates `tm` or `fuzzy` statuses depending on match type.
- Batch auto-translate creates `auto` translations.
- Clearing removes the translation and returns the row to `untranslated`.

### Status State Machine

Every status change is validated by a formal state machine (`src/web/statusMachine.ts`).
Not every actor can move a translation to any status — the rules are as follows:

| From (current)                                      | To (new)   | Who can do this                |
| --------------------------------------------------- | ---------- | ------------------------------ |
| _(none / any)_                                      | `draft`    | translator, reviewer, admin    |
| _(any)_                                             | `tm`       | system only (TM engine)        |
| _(any)_                                             | `fuzzy`    | system only (TM engine)        |
| _(any)_                                             | `auto`     | system only (LLM batch)        |
| _(any)_                                             | `human`    | system only (EET / CSV import) |
| `draft`, `tm`, `fuzzy`, `auto`, `human`             | `reviewed` | reviewer, admin                |
| `draft`, `tm`, `fuzzy`, `auto`, `human`, `reviewed` | `rejected` | reviewer, admin                |

Key rules:

- **Translators cannot approve** their own work — they can only save drafts.
- **Reviewers can approve or reject** any non-deleted translation.
- **Rejected strings** can be re-opened by saving a new text (→ `draft`) and then re-approved.
- **System actor** (automated pipelines) bypasses all restrictions so imports and TM auto-apply always work.

The frontend endpoint `GET /api/strings/status-transitions?from=<status>` returns the list of
statuses reachable from the current one for the logged-in user, which the editor uses to
enable or disable the Approve / Reject buttons accordingly.

Where you can change status:

- quick action buttons in the grid
- buttons in the detail panel
- context menu
- keyboard shortcuts such as `Ctrl+Shift+A` and `Ctrl+Shift+R`
- bulk approve/reject actions for selected rows

Badge colors in the current UI:

- **Reviewed / Approved**: green
- **Draft**: light green
- **Rejected**: red
- **TM**: blue
- **Fuzzy**: cyan
- **Auto**: orange
- **Untranslated**: gray badge

In addition to the badge itself, the grid row background is tinted by status:

- untranslated rows use an orange-brown background
- draft rows use dark green
- rejected rows use dark red
- TM and auto rows use dark teal
- fuzzy rows use dark amber
- reviewed and approved rows use the normal background

---

## Batch Actions

You can select multiple rows and apply actions to all of them at once.

How selection works today:

- use row checkboxes
- use **Space** on the active row
- use **Ctrl+A** to select or deselect all rows on the current page

The current UI does **not** implement Shift+Click range selection.

Available batch actions:

- **Auto-translate N**: sends the selected rows to the LLM batch translation endpoint
- **Approve N**: marks selected translations as reviewed
- **Reject N**: marks selected translations as rejected
- **Copy source → translation** for all selected rows from the context menu

Batch actions appear in the toolbar when at least one row is selected.
Additional bulk actions appear in the context menu when multiple selected rows include the row you right-clicked.

Current limitation: there is no dedicated **copy best TM suggestion to all selected rows** action in the editor.

---

## Search and Replace

Use the **Search & Replace** toolbar button to open the dialog.

Important correction: the current editor does **not** define a `Ctrl+H` shortcut for this dialog.

The dialog currently supports:

- **Search** string
- **Replace with** string
- **Use regex** checkbox
- **Preview** button for dry-run mode
- **Apply** button to perform the replacement

Preview behavior:

- the backend runs in `dryRun=true` mode
- the dialog shows the match count in the Preview button label
- the preview list shows up to the first 20 matches
- each preview row includes `FormID`, old text snippet, and new text snippet

Scope in the current implementation:

- **current mod only**
- **current target language only**

There is currently **no scope selector** for current filter, current page, or all mods.

---

## Context Menu

Right-click any row to open the context menu.

The current context menu includes these actions, depending on the row state:

- **Approve**: mark the row as reviewed
- **Reject**: mark the row as rejected
- **Clear translation**: delete the current translation
- **Copy source → translation**: copy the source text into the translation field

If the row already has a translation, the menu also shows text utilities:

- **UPPERCASE**
- **lowercase**
- **Capitalize first letter**
- **Trim whitespace**

If multiple rows are selected and the right-clicked row is part of that selection, the menu also shows bulk actions:

- **Approve N rows**
- **Reject N rows**
- **Auto-translate N rows**
- **Copy source → translation (N)**

The current context menu does **not** include actions such as **Apply TM**, **Copy FormID**, **Open in INNR editor**, or **Reset to Empty** under those exact names.

---

← [Importing Mods](02-importing-mods.md) | [Home](README.md) | **Next: [Keyboard Shortcuts →](04-keyboard-shortcuts.md)**
