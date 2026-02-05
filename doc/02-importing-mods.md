# 02 — Importing Mods

Learn how to bring a Fallout 4 mod into the tool so its strings are ready to translate.

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

| File | Description |
|------|-------------|
| `.esp` / `.esm` / `.esl` | Bethesda mod plugin — primary source of translatable strings |
| `.ba2` | Bethesda archive — may contain books, interface files, PEX scripts |
| `.eet` | Legacy project file — imports existing translations |
| `.csv` | Tab- or semicolon-delimited translation table |

---

## Starting an Import

> TODO: Describe the Imports page (`/imports`).
> Explain the three tabs: Mod Imports, EET Imports, CSV Imports.
> Show how to click "Upload" / drag-and-drop a file.
> Describe the language picker (Source Language, Target Language) shown after upload.
> Screenshot placeholder.

---

## Import Progress (SSE)

Import is a background process. The progress bar updates in real time via
Server-Sent Events (SSE) — no need to refresh the page.

> TODO: Describe the progress bar stages:
> - Reading ESP structure
> - Extracting string records
> - Matching against Translation Memory
> - MCM / PEX string extraction (if BA2 present)
> Screenshot / animation placeholder.

---

## Pausing and Cancelling

> TODO: Explain the Pause and Cancel buttons during import.
> Describe what "paused" means (job persists, can be resumed).
> Describe what "cancelled" means (job deleted, strings not committed).

---

## What Happens During Import

When you import a mod, the pipeline:

1. Reads the ESP/ESM/ESL binary — extracting all translatable record fields.
2. Optionally reads the paired BA2 archive for MCM strings and PEX scripts.
3. Stores every string with its FormID, record type (GRUP), field name, and EDID.
4. Runs the **TM waterfall** to auto-fill translations from previous work.

> TODO: Expand each step with detail.
> Explain what GRUP, FormID, EDID mean for translators.

---

## TM Auto-match After Import

After strings are stored, the tool automatically tries to fill translations
from the Translation Memory.

See [Translation Memory](05-translation-memory.md) for how the 5-method waterfall works.

---

## Re-importing an Updated Mod

If the mod author releases a new version, you can re-import it.
The tool detects the previous version and offers to carry over your existing translations
to the matching strings.

See [Diff & Re-import](11-diff-and-reimport.md) for the full workflow.

---

## Importing BA2 Archives

BA2 archives can contain:
- **MCM strings** — Mod Configuration Menu option labels
- **PEX scripts** — compiled Papyrus script string literals

> TODO: Explain uploading a BA2 alongside or separately from the ESP.
> Note that BA2 is optional — ESP-only import works fine.

---

## Importing EET Files (Legacy)

EET files are projects from the legacy desktop tool.
Importing an EET file migrates existing translations into the pipeline database.

> TODO: Describe the EET Imports tab.
> Explain what data is imported (strings, translations, statuses).
> Note any limitations compared to ESP import.

---

## Importing CSV Files

CSV files can contain pre-translated strings exported from another tool.

> TODO: Describe expected CSV format (columns, delimiters, encoding).
> Describe the CSV Imports tab and the preview step.
> Explain conflict resolution (what happens when a string already has a translation).

---

## Troubleshooting

> TODO: Common errors and how to fix them:
> - "File too large"
> - "Unsupported format"
> - "No strings found" (e.g., ESM with external STRINGS file)
> - Import stuck / SSE lost
> - Duplicate mod — same name already exists

---

← [Getting Started](01-getting-started.md) | [Home](README.md) | **Next: [The Editor →](03-editor.md)**
