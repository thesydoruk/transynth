# 03 — The Editor

The editor is the main workspace for reviewing, correcting, and completing translations.

---

## Table of Contents

- [Opening the Editor](#opening-the-editor)
- [Editor modes](#editor-modes)
- [The String Grid](#the-string-grid)
  - [Columns](#columns)
  - [Infinite scroll](#infinite-scroll)
  - [Sorting](#sorting)
- [Filter Row](#filter-row)
- [Selecting and Editing Rows](#selecting-and-editing-rows)
- [The Detail Panel](#the-detail-panel)
  - [Source and Translation Text Areas](#source-and-translation-text-areas)
  - [RAG Examples Tab](#rag-examples-tab)
  - [QA Issues Tab](#qa-issues-tab)
  - [Revision History Tab](#revision-history-tab)
- [Status Badges](#status-badges)
  - [Status State Machine](#status-state-machine)
- [Batch Actions](#batch-actions)
- [Search and Replace](#search-and-replace)
- [Context Menu](#context-menu)

---

## Opening the Editor

From a game’s mods list (`/games/:gameId/mods`), click the name of a mod to open its editor.
The editor URL is `/games/:gameId/mods/:id`. Home `/` is the games catalogue, not the mods list.

If you are updating an existing mod version, the editor also exposes an **Update** button.
That uploads a newer plugin or archive and redirects you into the diff workflow once the new import is ready.

The circular controls next to the mod name start background jobs for the whole
mod: TM apply, LLM translate, LLM verify, skip-detect (heuristic or LLM),
gender-detect (Bethesda only), and voice (missing / all). The same controls
exist on the Mods list. **Apply from mod** on the toolbar copies translations
from another imported plugin. See [LLM Translation](06-llm-translation.md) and
[Voice](09-voice.md).

---

## Editor modes

The toolbar switch changes the workspace. The choice is stored in the URL as
`?mode=`.

| Mode        | Games              | What it is                                           |
| ----------- | ------------------ | ---------------------------------------------------- |
| **Strings** | All                | Virtualised grid of every translatable row. Default. |
| **Dialogs** | Bethesda only      | Transcript by topic / branch / scene / conversation. |
| **Voice**   | Bethesda and Disco | Speakers and voiced lines. See [Voice](09-voice.md). |

Disco has no Dialogs tab, no FormID / gender columns, no gender-detect, and no
INNR link. Grid headers become type / audio / PO key (`Dialogues.po · msgctxt::msgid`).
The **Field** column is gettext **msgctxt** (`Dialogue Text/…`, `Alternate1/…`,
`*_EFFECT`), not a Bethesda subrecord. Saves fold `«»` to ASCII `"…"`; the
LLM path also restores `--` and nested `'…'`. See
[LLM Translation](06-llm-translation.md#disco-lockit).

**Dialogs** (Bethesda): the left navigator lists groups. Keys `1`–`4` switch
scope (topics, branches, scenes, conversations). The transcript supports Fill TM
/ Fill LLM, find, next unfinished line (`N`), play (`P`), and inline edit
(`Enter`). Speaker gender can be overridden on the transcript header.

---

## The String Grid

The grid lists all translatable strings in the mod — one row per string.
The grid is fully virtualised and loads more rows automatically as you scroll,
so there is no page-by-page navigation (see [Infinite scroll](#infinite-scroll)).

### Columns

| Column          | Description                                                                      |
| --------------- | -------------------------------------------------------------------------------- |
| **Select**      | Per-row checkbox; the header checkbox selects every row matching the filter      |
| **GRUP**        | Record type signature (e.g. `DIAL`, `BOOK`, `NPC_`, `QUST`)                      |
| **FormID**      | Unique hexadecimal record identifier                                             |
| **EDID**        | Editor ID — the author's internal name for the record                            |
| **Field**       | Bethesda: sub-record (`FULL`, `DESC`, `NNAM`). Disco: gettext **msgctxt**        |
| **Source**      | Original English (or base-language) text                                         |
| **Translation** | Current best translation, plus a small QA count hint when issues exist           |
| **Actions**     | Quick actions: approve, reject, clear, copy source, and the current status badge |

### Infinite scroll

The grid loads strings in chunks of **100 rows** and appends the next chunk
automatically as you scroll toward the end of the loaded list — there is no
manual pagination. A footer below the rows shows the current progress in the
format `Loaded X of N`.

Because the list is virtualised, only the visible rows are rendered, so the grid
stays responsive even for mods with tens of thousands of strings.

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

The status dropdown supports:

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
- **Ctrl+A**, or the **header checkbox**, selects (or clears) **every row matching
  the current filter** — not just the rows loaded on screen. Individual rows can
  then be unchecked to exclude them from the selection.

Important correction: the current editor does **not** support inline editing directly inside the grid cell.
Editing happens in the Detail Panel.

Save behavior in the current implementation:

- Editing the translation field starts an **800 ms autosave timer**.
- Switching to another row flushes any pending autosave immediately.
- **Ctrl+S** saves manually.
- **Ctrl+Enter** also saves from the translation textarea.
- Clearing the translation field and saving removes the translation, returning the row to the untranslated state.
- Every save folds `«»` to ASCII `"…"`. Other lockit shape (`--`, `'title'`)
  is restored on the LLM / auto-normalize path, not on a manual save.

Press **Escape** to close the context menu, close the detail panel, or clear selection depending on what is open.

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
- a max-length indicator when an active `max_length` QA rule matches the current row
- inline placeholder highlighting for formatting tokens such as `%s`, `{0}`, `{Name}`, `$var`, `[TAG]`, and HTML-like tags
- quick buttons for **Copy src** and **Save**

If the record is a `BOOK` or the source contains HTML-like markup, the panel shows a **Book / HTML editor** button.
That opens a split-pane modal with raw markup on one side and a live preview on the other.

When a matching `max_length` QA rule exists for the current GRUP/field, the panel shows a limit chip:

- `Max: N · X left` while within limit
- `Max: N · Exceeded by X` when over limit

Placeholder-like tokens are highlighted inline inside the translation textarea so you can visually preserve formatting markers while editing.
QA still remains the source of truth for placeholder mismatch validation.

### RAG Examples Tab

The RAG Examples tab shows up to **10** reference translations, retrieved via
the same RAG hybrid search that feeds the LLM (only `reviewed`/`human`
translations are eligible).

Each row includes:

- a match badge showing the match quality as a percentage
- a match method badge
- the reference translation (hover to see its source text)
- an **Apply** button

Current match methods in the UI are:

- `exact`
- `numeric`
- `punct_norm`
- `fuzzy`
- `semantic` (pgvector embedding)

Clicking **Apply** copies that reference translation into the draft translation field.
It does not save immediately; the normal autosave/manual-save logic still applies.

See [Translation Memory](05-translation-memory.md) for the broader TM workflow.

### QA Issues Tab

Shows any QA violations for the current string.
Each issue has a severity and a message.

The current editor uses **error** and **warning** severities.
There is no separate `info` severity in the QA panel.

Examples of QA checks generated by the backend:

- **empty_translation**: the translation is empty
- **placeholder_mismatch**: placeholder tokens differ between source and translation
- **same_as_source**: translation text is identical to the source
- **length_delta**: translation length differs too much from the source
- **forbidden_chars**: translation contains forbidden control characters or configured forbidden characters
- **max_length**: translation exceeds a configured maximum length for that record type or path
- **glossary_violation**: source contains a glossary term but the required translation is missing
- **gender_mismatch**: Ukrainian wording commits to a gender that contradicts the speaker or addressee of the dialog line
- **duplicate_inconsistency**: the same exact source text within the same record signature is translated differently elsewhere

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

| Status                 | Meaning                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| **Untranslated**       | No translation exists yet                                                  |
| **Draft**              | Human-entered translation, not yet reviewed                                |
| **Reviewed**           | Manually reviewed and confirmed in the editor                              |
| **Approved** (`human`) | Imported or otherwise marked as a confirmed human translation              |
| **TM**                 | Filled automatically from Translation Memory                               |
| **Fuzzy**              | Filled from a fuzzy TM-style match                                         |
| **Auto**               | Filled automatically by LLM translation                                    |
| **Rejected**           | Explicitly marked as rejected                                              |
| **Skip**               | Marked to leave untranslated (heuristic, LLM skip-detect, or context menu) |

How statuses change:

- Saving a typed translation creates or updates a **Draft** translation.
- With **Auto-approve on save** enabled in Settings, saves go directly to `reviewed`.
- **Apply TM** creates `tm` or `fuzzy` statuses depending on match type.
- Batch auto-translate creates `auto` translations.
- Clearing removes the translation and returns the row to `untranslated`.
- **Skip-detect** (toolbar) or **Skip** in the context menu marks rows as `skip`
  so later TM/LLM passes leave them alone.

Valid status values are defined in `src/web/statusMachine.ts`. Automated pipelines
(TM, LLM, import) write system statuses; manual edits in the editor save as `draft`
unless auto-approve is enabled.

Where you work on translations:

- the mod editor grid and detail panel
- inline editors on other pages
- batch auto-translate for selected rows

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

How selection works:

- use row checkboxes
- use **Space** on the active row
- use **Ctrl+A** or the **header checkbox** to select / clear all rows matching the filter

The current UI does **not** implement Shift+Click range selection.

Available batch actions:

- **Auto-translate N**: sends the selected rows to the LLM batch translation endpoint
- **Copy source → translation** for all selected rows from the context menu

Batch actions appear in the toolbar when at least one row is selected.
The context menu applies its actions to the **whole selection** when you
right-click a selected row; right-clicking an unselected row acts on that row only.

**Select all matching:** the header checkbox selects every row matching the
current filter (potentially the whole mod), not just the rows scrolled into view.
Auto-translate resolves the full filtered set on the server when "select all matching"
is active, but each LLM request is still limited to **100 strings per batch**.
The per-row text actions (clear, copy source, text transforms) apply to the
currently loaded selected rows.

Current limitation: there is no dedicated **copy best TM suggestion to all selected rows** action in the editor.

---

## Search and Replace

Use the **Search & Replace** toolbar button to open the dialog.

Important correction: the current editor does **not** define a `Ctrl+H` shortcut for this dialog.

The dialog supports:

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

There is **no scope selector** for current filter or all mods.

---

## Context Menu

Right-click any row to open the context menu.

The context menu always offers the same families of actions; labels show the
target count when a selection exists:

- **LLM translate** / **Apply TM** for the row or the selection
- **Skip** / unskip
- **Set status** (draft, reviewed, rejected, tm, fuzzy, auto)
- **Clear translation** and **Copy source → translation**
- Text utilities when a translation exists: UPPERCASE, lowercase, capitalize, trim

There is no **Copy FormID** or **Open in INNR editor** item. INNR is a toolbar
link when the mod has INNR records.

---

← [Importing Mods](02-importing-mods.md) | [Home](README.md) | **Next: [Keyboard Shortcuts →](04-keyboard-shortcuts.md)**
