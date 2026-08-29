# 02 — Importing Mods

Learn how to bring a Bethesda plugin/archive or a Disco Elysium Final Cut
langpack into the tool so its strings are ready to translate.

---

## Table of Contents

- [Supported File Types](#supported-file-types)
- [Starting an Import](#starting-an-import)
- [Import Progress (SSE)](#import-progress-sse)
- [Pausing and Cancelling](#pausing-and-cancelling)
- [What Happens During Import](#what-happens-during-import)
- [TM Auto-match After Import](#tm-auto-match-after-import)
- [Re-importing an Updated Mod](#re-importing-an-updated-mod)
- [Applying an Imported Translation Mod](#applying-an-imported-translation-mod)
- [Importing BA2 Archives](#importing-ba2-archives)
- [Nexus Mod Relations on Mod Page](#nexus-mod-relations-on-mod-page)
- [Importing EET Files (Legacy)](#importing-eet-files-legacy)
- [Importing CSV Files](#importing-csv-files)
- [Troubleshooting](#troubleshooting)

---

## Supported File Types

| File                     | Description                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `.esp` / `.esm` / `.esl` | Bethesda mod plugin — primary source of translatable strings (FO4, FO76, FO3, FNV, OB, MW, SSE, SLE)         |
| `.zip` / `.7z` / `.rar`  | Bethesda: plugin + optional `.ba2` / `.bsa`. Disco: Final Cut `.po` + `.wav` pack (no plugin required)       |
| `.eet`                   | Legacy project file — imports existing translations                                                          |
| `.csv`                   | RFC 4180-style comma-separated translation table                                                             |
| `.ba2`                   | Fallout 4/76 archive — discovered automatically next to the plugin or inside an uploaded archive             |
| `.bsa`                   | Skyrim SE/LE and FO3/FNV archive — discovered automatically next to the plugin or inside an uploaded archive |

---

## Starting an Import

Open the **Mods** page for the current game (`/games/:gameId/mods`).

The main upload bar accepts plugin and archive files
(`.esp` / `.esm` / `.esl` / `.zip` / `.7z` / `.rar`).
EET and CSV files are under **Advanced import** on the same page.

All jobs appear in one list, each with a type badge:

- `MOD` for plugin or archive imports
- `EET` for legacy projects
- `CSV` for CSV imports

To import a plugin or archive:

1. Click the file picker and select one or more files.
2. Click **Upload**.
3. The file is added to the job list and import starts automatically.
4. Use the play button for manual re-run after pause/failure, or use **Import All** for all pending jobs.

If the page is still empty, the current UI shows a deterministic empty-state card with two direct next actions:

- **Choose files** — opens the upload picker immediately
- **Browse NexusMods** — jumps to the game-scoped Nexus browser so you can discover a mod before importing. Needs `NEXUS_API_KEY` in `.env` (Nexus → account → API). Without it the Discover page shows a blocking banner.

There is **no dedicated drag-and-drop drop zone** in the web UI.
Use the file picker instead.

Language selection depends on import type:

- **Mod import, non-localized plugin:** starts immediately using current/default languages (`srcLang` and `tgtLang`), without waiting for a modal.
- **Mod import, localized plugin:** reads available locales from the mod's STRINGS data and also starts immediately.
- **EET import:** starts immediately using current/default **Source Language** and **Target Language** values.
- **CSV import:** starts immediately using current/default **Source Language** and **Target Language** values.

Practical note: if you need to adjust languages manually before re-running a paused/failed job, use the job actions in the list.

---

## Import Progress (SSE)

Import is a background process. The progress bar updates in real time via
Server-Sent Events (SSE) — no need to refresh the page.

When you start an import, the browser opens an SSE stream to the backend.
The page shows a live percentage bar while the worker reports `imported / total` progress.

What you will see in the current UI:

- A status badge while the job is waiting, paused, failed, or completed.
- A live percentage bar while the job is actively running.
- Automatic refresh of the job list every few seconds, even when a job is not open in a modal.

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

- For `MOD` jobs, the UI asks for explicit confirmation before deletion.
- It removes the import job row and uploaded source file.
- For `MOD` jobs that were fully imported, it also removes the linked mod row from the database (records/strings/translations deleted via cascade).
- If the mod came from an extracted archive, the unpacked `_extracted_*` folder is also deleted when present.

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
   The importer parses the plugin with the ESP reader and extracts translatable rows before full ingestion. A preview is still available in manual restart flows.

4. **Handle localized and non-localized plugins differently.**
   For a localized plugin, the importer looks for matching `.strings`, `.dlstrings`, and `.ilstrings` data in a sibling BA2 or loose `Strings/` directory. For a non-localized plugin, it imports raw text directly from the plugin and uses current/default language settings.

5. **Store records and strings in the database when a real mod import actually starts.**
   The importer creates the `mods` row lazily at import time, not during upload. This avoids polluting the database with placeholder mods for files that are only being previewed or used as temporary translation sources. Once the import starts, each string is associated with the mod, record signature, path, editor ID when available, and normalized text used by later search and matching features.

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

See [Translation Memory](05-translation-memory.md) for how exact/anchor TM matching works.

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

## Applying an Imported Translation Mod

This section describes the exact backend matching logic used by imported-translation apply flows.

The goal is to take raw strings from an imported translation mod (for example,
RU strings) and apply them as translations to a target base mod. This is useful
when you imported a translated mod file and want to transfer its text into the
translation table of another mod.

### Current apply workflow behavior

- In **Apply to existing**, UI asks for the translation mod language and base mod only.
- The target language for write-back is inferred automatically from the imported
  translation language (no separate target-language selector).
- In the normal temporary apply flow, the backend reads strings directly from the
  import job on disk and does **not** create a temporary standalone mod row in `mods`.
- The uploaded file stays on disk after apply so it can be reused or inspected later.
- The system does not automatically delete related import artifacts from the database after apply.

### Why strict FormID-only matching fails

When a translation mod is based on an older version of the original mod,
record identifiers may shift:

- FormIDs can be remapped.
- Paths can differ by format details.
- Some records are added/removed between versions.

If matching is done only by `FormID + path`, many valid translations are missed.

### Matching cascade used in the project

The current implementation uses a strict-to-loose fallback sequence.
The first successful unique match is applied.

1. `identity`: `FormID + path` — exact structural match.
2. `identity_ranked`: when the same `FormID + path` key appears multiple times
   (as is normal for Bethesda dialogue INFO records under one topic), rows are matched
   **positionally**: the nth imported record aligns with the nth target record within
   the same key bucket. This uses an internal index to distinguish
   duplicate-key records.
3. `formid_signature_path`: `FormID + signature + path_simplified`
4. `edid_signature_path`: `EDID + signature + path_simplified`
5. `edid_path`: `EDID + path`
6. `edid_signature`: `EDID + signature`
7. `formid_signature`: `FormID + signature`
8. `formid_only`: `FormID`

This order preserves safety: exact structural identity first, looser heuristics
only when stronger keys fail.

### Ambiguity guardrails

For each key type, backend stores candidates in a map as **unique-only**:

- If one key points to one translation text, it is usable.
- If one key points to different translation texts, that key is marked
  ambiguous and ignored for auto-apply.

The `identity_ranked` step is the sole exception to this rule: it is designed
specifically for keys that **must** be ambiguous (multiple records with the same
`FormID + path`). Instead of discarding them, it aligns them by their SQL
`ROW_NUMBER()` within the partition — giving each occurrence its own stable slot.

This prevents accidental writes caused by collisions in loosely matched keys,
especially on `EDID`-based fallbacks.

### Normalization rules before matching

To make key comparison stable across file/style differences, backend normalizes:

- `path`: lowercase, backslashes converted to forward slashes, duplicate slashes collapsed.
- `FormID`: uppercased.
- `EDID`: lowercased.

So equivalent values like `INFO\\FULL` and `info/full` are treated as equal.

### What is skipped deliberately

- Target strings that already have a translation in `targetLang` are skipped.
- Empty imported text is skipped.
- Ambiguous fallback keys are skipped.
- Unmatched rows are counted but not modified.

### Runtime observability

Server logs include per-method counters in the `methods={...}` object, so you can
see whether matching came mostly from strict identity or fallback layers.

Example (shape):

```text
methods={"identity":6597,"identity_ranked":1524,"formid_signature_path":0,"edid_signature_path":0,"edid_path":0,"edid_signature":0,"formid_signature":0,"formid_only":0}
```

In the example above, 6597 rows matched by exact identity and 1524 were resolved
positionally via `identity_ranked` (duplicate-key INFO dialogue records).

If `identity` and `identity_ranked` are both low while fallback counters are high,
the translation mod is likely from a different mod version or record structure.

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

How BA2 detection works:

- For localized STRINGS data, the importer first looks for a BA2 named like the plugin stem or `PluginName - Main.ba2`.
- For MCM and PEX extraction, the importer scans all BA2 files in the plugin directory.
- Loose `Strings/`, `Interface/Translations/`, and `Scripts/` files are also supported where applicable.
- Voice BA2/BSA archives (`*Voices*.ba2` and the same internal `Sound/Voice/` tree in several locales) unpack in place. Later archives overwrite earlier ones. Synthesized output under `_localize_{hash}/{lang}/` is not affected.

BA2 is optional.
An ESP-only import still works for non-localized plugins and for plugins whose translatable text is stored directly in the plugin records.

Important limitation: if you upload an archive with multiple plugins, the current importer uses the first discovered plugin. For maximum control, upload the exact plugin or a minimal archive containing the files you intend to import.

---

## Nexus Mod Relations on Mod Page

Discover is the game hub **Discover** card, route `/games/:gameId/nexus`.
An empty search lists Nexus mods for that game (paginated). It is not the
imported-mods workspace (`/games/:gameId/mods`).

Nexus details are `/games/:gameId/nexus/:modId`. The bottom block uses three
relation tabs:

- **Possible translations** — heuristic list of likely translation mods,
  grouped by language with flags.
- **Requires** — official Nexus dependency list for mods required by the current mod.
- **Required by** — official Nexus relation list for mods that depend on the current mod.

Each item links to Nexus when the related mod has a valid Nexus `modId`.
If relation data is unavailable in Nexus GraphQL for that mod, the tabs show
an empty-state message and the rest of the page continues to work.

In the **Attached Files** table on the mod page, each Nexus file also has two
actions:

- **Download** — streams the file through the backend proxy.
- **Import** — downloads the file to the server and immediately starts a mod
  import job for the selected game.

---

## Importing EET Files (Legacy)

EET files are projects from the legacy desktop tool.
Importing an EET file migrates existing translations into the pipeline database.

EET imports are under **Advanced import** on the Mods page. They appear in the job list with the `EET` badge.

Workflow:

1. Upload a `.eet` file.
2. Import starts automatically with current/default languages.
3. Track progress in the jobs list.

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

CSV imports are under **Advanced import** on the Mods page. They appear in the job list with the `CSV` badge.

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

Workflow:

1. Upload the CSV file.
2. Import starts automatically with current/default languages.
3. Track progress in the jobs list.

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
  The web server limits multipart uploads only if `UPLOAD_MAX_FILE_SIZE_MB` is set. Unset means no practical application-level cap. You can also split oversized archives or upload only the needed plugin.

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
