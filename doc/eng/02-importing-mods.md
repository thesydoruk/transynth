# 02 — Importing Mods

Learn how to bring a Fallout 4, Fallout 76, Fallout 3, Fallout: New Vegas, Skyrim SE, or Skyrim LE mod into the tool so its strings are ready to translate.

---

## Table of Contents

- [Supported File Types](#supported-file-types)
- [Starting an Import](#starting-an-import)
- [Import Progress (SSE)](#import-progress-sse)
- [Pausing and Cancelling](#pausing-and-cancelling)
- [What Happens During Import](#what-happens-during-import)
- [TM Auto-match After Import](#tm-auto-match-after-import)
- [Re-importing an Updated Mod](#re-importing-an-updated-mod)
- [Importing BA2 Archives](#importing-ba2-archives)
- [Importing EET Files (Legacy)](#importing-eet-files-legacy)
- [Importing CSV Files](#importing-csv-files)
- [Troubleshooting](#troubleshooting)

---

## Supported File Types

| File                     | Description                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `.esp` / `.esm` / `.esl` | Bethesda mod plugin — primary source of translatable strings (FO4, FO76, FO3, FNV, SSE, SLE)                 |
| `.zip` / `.7z` / `.rar`  | Mod archive containing a plugin and, optionally, matching `.ba2` / `.bsa` files or loose assets              |
| `.eet`                   | Legacy project file — imports existing translations                                                     |
| `.csv`                   | RFC 4180-style comma-separated translation table                                                             |
| `.ba2`                   | Fallout 4/76 archive — discovered automatically next to the plugin or inside an uploaded archive             |
| `.bsa`                   | Skyrim SE/LE and FO3/FNV archive — discovered automatically next to the plugin or inside an uploaded archive |

---

## Starting an Import

Open the **Imports** page at `/imports`.

The current UI uses **one unified imports page**, not three separate tabs.
All uploaded jobs appear in one combined list, each with a type badge:

- `MOD` for plugin or archive imports
- `EET` for legacy projects
- `CSV` for CSV imports

At the top of the page there is a single upload bar.
Use it like this:

1. Click the file picker and select one or more files.
2. Click **Upload**.
3. The file is added to the job list.
4. Start the job with the play button, or use **Import All** for all pending jobs.

There is currently **no dedicated drag-and-drop drop zone** in the web UI.
Use the file picker instead.

Language selection depends on import type:

- **Mod import, non-localized plugin:** after upload, a preview modal opens and asks for one language, labeled as the language of the text in the plugin. That value is used as both source and target language metadata for the imported source strings.
- **Mod import, localized plugin:** the importer reads available locales from the mod's STRINGS files and starts immediately, without a language confirmation modal.
- **EET import:** the preview modal asks for both **Source Language** and **Target Language** before import starts.
- **CSV import:** the preview modal also asks for both **Source Language** and **Target Language**.

Practical note: if you upload multiple files at once, the per-file preview modal does not automatically open for each one. Upload one file at a time if you want to inspect the preview and adjust languages before starting.

---

## Import Progress (SSE)

Import is a background process. The progress bar updates in real time via
Server-Sent Events (SSE) — no need to refresh the page.

When you start an import, the browser opens an SSE stream to the backend.
The page shows a live percentage bar while the worker reports `imported / total` progress.

What you will see in the current UI:

- A status badge while the job is waiting, paused, failed, or completed.
- A live percentage bar while the job is actively running.
- Automatic refresh of the job list every few seconds, even when a job is not currently open in a modal.

The current UI does **not** show a multi-step stage list such as "Reading ESP", "Matching TM", or "Extracting PEX".
Instead, the progress display is record-count based.

Conceptually, a mod import progresses through these backend steps:

1. Upload and, for archives, extraction with 7-Zip.
2. Plugin analysis and preview generation.
3. Record and source-string ingestion into the database.
4. Optional MCM text ingestion from `Interface/Translations` files.
5. Optional PEX string ingestion from compiled Papyrus scripts.

EET and CSV imports are simpler: they parse the uploaded file, ingest records, and stream numeric progress until completion.

---

## Pausing and Cancelling

Each running job shows these actions:

- **Pause** (`⏸`) requests a cooperative stop.
- **Cancel** (`⏹`) requests an immediate stop.
- **Delete** (`🗑`) is only available when the job is not running.

What **Pause** means in the current implementation:

- The worker finishes the current batch, commits the work already processed, and marks the job as `paused`.
- The job remains in the list.
- The `imported_records` counter is preserved.
- Press **Start** again to resume from that checkpoint.

What **Cancel** means in the current implementation:

- The worker stops cooperatively at the next safe checkpoint.
- Already committed records stay in the database.
- The job is **not** rolled back.
- The current implementation marks the job as `failed` rather than using a separate `cancelled` status.
- Because the progress counter is preserved, you can usually press **Start** again to continue from the last committed point.

What **Delete** means:

- It removes the import job row and the uploaded source file.
- It does **not** remove strings or translations that were already imported into the database.

This means pause and cancel are operational controls, not transactional rollback controls.

---

## What Happens During Import

When you import a mod, the pipeline:

1. Reads the ESP/ESM/ESL binary — extracting all translatable record fields.
2. Optionally reads the paired BA2 archive for MCM strings and PEX scripts.
3. Stores every string with its FormID, record type (GRUP), field name, and EDID.
4. Runs the **TM waterfall** to auto-fill translations from previous work.

In the current web importer, the workflow is:

1. **Register the uploaded file as an import job.**
   The backend stores the upload under `uploads/`, hashes the file, and reuses an existing job if the exact same file hash was uploaded before.

2. **For archive uploads, extract the archive and discover mod files.**
   `.zip`, `.7z`, and `.rar` uploads are unpacked with 7-Zip. The importer searches the extracted tree for plugin files and BA2 archives.

3. **Read the plugin and preview translatable rows.**
   The importer parses the plugin with the ESP reader and extracts translatable rows before full ingestion. This preview is what you see in the modal.

4. **Handle localized and non-localized plugins differently.**
   For a localized plugin, the importer looks for matching `.strings`, `.dlstrings`, and `.ilstrings` data in a sibling BA2 or loose `Strings/` directory. For a non-localized plugin, it imports raw text directly from the plugin and uses the language you selected in the modal.

5. **Store records and strings in the database.**
   The importer writes mod rows, record rows, and source-string rows. Each string is associated with the mod, record signature, path, editor ID when available, and normalized text used by later search and matching features.

6. **Optionally ingest BA2-derived text.**
   After the main plugin pass, the importer scans BA2 files or loose assets for:
   - **MCM text** in `Interface/Translations/*.txt`, stored with signature `MCM`
   - **PEX strings** from compiled Papyrus scripts, stored with signature `PEX`

Important correction: the current web import workers do **not** automatically run the Translation Memory waterfall during import.
TM application is a separate action you run later from the mod editor.

Terms you will see in previews and editor tables:

- **GRUP / Signature**: the Bethesda record type, such as `NPC_`, `INFO`, `QUST`, `MCM`, or `PEX`. This tells you what kind of game object the string belongs to.
- **FormID**: the record's hexadecimal identifier inside the plugin. This is useful when comparing strings with xEdit or other modding tools.
- **EDID**: the editor ID, a human-readable internal record name when the plugin defines one. Translators often use it as context when the source text is short or ambiguous.

---

## TM Auto-match After Import

After import, you can fill untranslated strings from the Translation Memory.

See [Translation Memory](05-translation-memory.md) for how the 5-method waterfall works.

The current web UI does **not** apply TM automatically as part of the import worker.
Instead, open the imported mod in the editor and use **Apply TM** there.

This distinction matters:

- Import creates the source-string inventory.
- TM application is a separate explicit step.
- Diff/carry-over for a newer mod version is also a separate step.

---

## Re-importing an Updated Mod

If the mod author releases a new version, you can re-import it.
The tool detects previous versions of the same mod and offers a shortcut into the
diff and carry-over workflow.

See [Diff & Re-import](11-diff-and-reimport.md) for the full workflow.

In the current implementation, this is how it works:

1. Import the newer plugin or archive.
2. After the import finishes, the app checks whether other mods with the same name but a different file hash already exist.
3. If older versions are found, a **Reimport** modal appears.
4. Select the older version and click **Open Diff**.
5. The app opens the Diff page with both mod IDs pre-filled so you can compare versions and carry translations over deliberately.

This is not an automatic copy step.
The current UI detects the relationship and helps you jump into the diff workflow, but carry-over itself is still a separate action.

If you upload the exact same file again, the backend reuses the existing import job by file hash instead of creating a duplicate job.

---

## Importing BA2 Archives

BA2 archives can contain:

- **MCM strings** — Mod Configuration Menu option labels
- **PEX scripts** — compiled Papyrus script string literals

The current UI does **not** accept a bare `.ba2` upload by itself.

Instead, BA2 content is discovered automatically in these cases:

- You upload an archive (`.zip`, `.7z`, `.rar`) that contains both the plugin and one or more BA2 files.
- The imported plugin is processed from a directory that already contains matching BA2 or loose asset files.

For normal browser-based use, the practical way to import BA2-backed content is to upload a complete archive that contains the plugin and its related assets together.

How BA2 detection works today:

- For localized STRINGS data, the importer first looks for a BA2 named like the plugin stem or `PluginName - Main.ba2`.
- For MCM and PEX extraction, the importer scans all BA2 files in the plugin directory.
- Loose `Strings/`, `Interface/Translations/`, and `Scripts/` files are also supported where applicable.

BA2 is optional.
An ESP-only import still works for non-localized plugins and for plugins whose translatable text is stored directly in the plugin records.

Important limitation: if you upload an archive with multiple plugins, the current importer uses the first discovered plugin. For maximum control, upload the exact plugin or a minimal archive containing the files you intend to import.

---

## Importing EET Files (Legacy)

EET files are projects from the legacy desktop tool.
Importing an EET file migrates existing translations into the pipeline database.

EET imports now live on the unified **Imports** page as jobs with the `EET` badge.

Workflow:

1. Upload a `.eet` file.
2. Open the preview modal.
3. Choose **Source Language** and **Target Language**.
4. Review the preview table, which shows signature, FormID, EDID, field, source text, target text, and status.
5. Start the import.

What is imported from EET:

- Source strings
- Target translations when the EET record contains them
- EET status bytes

Status mapping:

- `0x63` (`confirmed`) is imported as a human translation with full confidence
- any other non-empty target text is imported as an automatic translation
- empty target text creates only the source-string side

Compared with a native mod import, EET import is a migration format, not a live plugin analysis pass.
It imports what is present in the EET file and does not inspect BA2 archives, loose STRINGS assets, MCM text files, or PEX scripts.

---

## Importing CSV Files

CSV files can contain pre-translated strings exported from another tool.

CSV imports also appear on the unified **Imports** page as jobs with the `CSV` badge.

Expected format in the current implementation:

- Encoding: UTF-8
- Delimiter: comma
- Quoting: standard CSV quoting with doubled double-quotes inside quoted values
- Header-based mapping: column order does not matter as long as the header names are present

Supported columns:

- `FormID`
- `Signature`
- `EDID`
- `Path`
- `Source`
- `Target`
- `Status`

Notes about the parser:

- The current parser is **comma-separated**, not semicolon-delimited and not tab-delimited.
- Missing columns are tolerated, but the import is most useful when the table includes the columns above.
- The `Path` column is treated as the record field/path identifier used for storage and later lookup.

Preview workflow:

1. Upload the CSV file.
2. Open the preview modal.
3. Choose **Source Language** and **Target Language**.
4. Review the preview table.
5. Start the import.

Status handling:

- `confirmed` maps to a human translation
- `untranslated` maps to the untranslated status byte
- numeric status values are accepted as-is
- any non-empty `Target` value that is not `confirmed` is imported as an automatic translation

Conflict handling in the current UI:

- There is **no interactive overwrite/merge dialog** during CSV import.
- The importer ingests the rows as uploaded.
- Duplicate identical translations for the same imported source string are deduplicated by the database constraint.
- CSV import is therefore best used for initial ingestion or migration, not as a surgical in-place merge tool for an already reviewed mod.

---

## Troubleshooting

- **"File too large"**
  The web server limits multipart uploads to `200 MB`. Split oversized archives, upload only the needed plugin, or remove unneeded assets before uploading.

- **"Unsupported format"**
  The current accepted upload types are `.eet`, `.csv`, `.esp`, `.esm`, `.esl`, `.zip`, `.7z`, and `.rar`. A bare `.ba2` file is not accepted by the upload API.

- **"No ESP/ESM/ESL plugin found in archive"**
  Your `.zip`, `.7z`, or `.rar` file did not contain a supported plugin. Extract it locally and confirm that the archive really contains the plugin you expect.

- **Localized mod imports fail because no locale files are found**
  For localized plugins, the importer expects matching STRINGS data in a BA2 or loose `Strings/` folder. If those files are missing, the import cannot resolve the LString text.

- **Import seems stuck or the SSE stream is lost**
  Refresh the page and inspect the job row. The list refreshes automatically, so a running or completed job should reappear with updated counts. If the job is `paused` or `failed`, press **Start** to resume from the last committed checkpoint.

- **Pause or Cancel did not undo imported rows**
  This is expected in the current implementation. Imports commit in batches and preserve already imported records. Pause/cancel stop future work; they do not roll the database back.

- **Duplicate upload behavior is confusing**
  The backend deduplicates by file hash. Uploading the exact same file again usually returns the existing job. Uploading a different file with the same mod name creates another mod version, which can later be compared in the diff workflow.

- **Archive contains multiple plugins**
  The current importer uses the first plugin it discovers inside the archive. If you need a specific plugin, upload that plugin directly or build a smaller archive with only the intended files.

---

← [Getting Started](01-getting-started.md) | [Home](README.md) | **Next: [The Editor →](03-editor.md)**
