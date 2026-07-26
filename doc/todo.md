# TODO

## Backlog (non-priority)

### Per-language voice BA2 archives on mod import

**Priority:** Low

Some localized mods ship separate voice BA2 archives per language (e.g. `MyMod - Voices_en.ba2`, `MyMod - Voices_fr.ba2`) that contain the **same internal file tree** (`Sound/Voice/<plugin>/...`) but different audio per locale.

**Current behavior:** `extractGameArchivesForImport` extracts **all** BA2/BSA archives in the import tree in place, with no language awareness. If multiple voice archives share the same internal paths, they are unpacked into the same directory and **overwrite each other** — only the last extracted archive survives.

**Expected behavior (future):** Similar to STRINGS locale discovery (`discoverLocaleSources`), detect the locale from the voice archive name and extract only the archive matching `src_lang` (or keep per-locale voice trees separate so they do not collide).

**Related code:**

- `src/modImport/extractBethesdaArchives.ts` — in-place BA2/BSA extraction
- `src/import/mod/extract.ts` — import manifest build
- `src/formats/ba2/creationKitArchiveRules.ts` — `voices` role (compression only today)
- `src/voice/discoverVoiceFiles.ts` — scans a single `Sound/Voice/<plugin>/` tree on disk

**Note:** Localized voice output is currently synthesized into `_localize_{hash}/{lang}/`, not imported from per-language voice archives. This task matters mainly for correct **source/reference audio** selection during import and TTS preview.
