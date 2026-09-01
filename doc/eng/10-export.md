# 10 — Exporting

Create the translation files that players install to play the mod in your language.

---

## Table of Contents

- [Export Formats](#export-formats)
- [STRINGS Files](#strings-files)
- [Patched ESP](#patched-esp)
- [BA2 Archive](#ba2-archive)
- [Langpack ZIP](#langpack-zip)
- [Full Localized Mod (ZIP)](#full-localized-mod-zip)
- [Triggering an Export](#triggering-an-export)
- [What to Include in a Mod Release](#what-to-include-in-a-mod-release)
- [Partial Exports and Drafts](#partial-exports-and-drafts)

---

## Export Formats

The pipeline can produce four types of output:

| Format           | File                                   | Purpose                                                                           |
| ---------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| **STRINGS**      | `.strings`, `.dlstrings`, `.ilstrings` | External string table files read by the game engine                               |
| **Patched ESP**  | `.esp` / `.esm`                        | Mod plugin with translations embedded directly                                    |
| **BA2 Archive**  | `.ba2`                                 | Fallout 4/76 archive containing translated STRINGS files                          |
| **BSA Archive**  | `.bsa`                                 | Skyrim SE/LE and FO3/FNV archive containing translated STRINGS files              |
| **Langpack ZIP** | `{stem}_{lang}_langpack.zip`           | Bethesda: changed STRINGS / ESP / PEX. Disco: translated `.po` + localized `.wav` |
| **Full mod ZIP** | `{stem}_{lang}.zip`                    | Bethesda: BA2/BSA (+ patched ESP when needed)                                     |

---

## STRINGS Files

Fallout 4 loads string data from binary table files alongside the mod plugin.
A typical translation release contains:

```
MyMod_en.STRINGS
MyMod_en.DLSTRINGS
MyMod_en.ILSTRINGS
```

Fallout 4 uses three distinct string table formats, identified by their file
extension:

| Extension    | Format                                        | Usage                                                           |
| ------------ | --------------------------------------------- | --------------------------------------------------------------- |
| `.STRINGS`   | Null-terminated UTF-8 strings                 | Generic text: item names, book titles, descriptions             |
| `.DLSTRINGS` | uint32 length prefix + text + null terminator | Long text: book bodies, quest journal (QUST/CNAM), generic DESC |
| `.ILSTRINGS` | Same binary layout as DLSTRINGS               | Dialogue lines (INFO/NAM1), subtitles                           |

**Player installation:** Translated `.STRINGS`, `.DLSTRINGS`, and `.ILSTRINGS`
files go in the `Data\Strings\` subfolder of the player's Fallout 4 installation
directory.

Only **localized mods** (those where text was moved to external string tables)
use this export format. Non-localized mods embed text directly in the plugin
binary — those are handled by the [Patched ESP](#patched-esp) export.

---

## Patched ESP

An alternative to STRINGS files is to write the translations directly into
a copy of the ESP/ESM plugin.

Use the Patched ESP option when a mod is **non-localized** — it stores text
directly inside the plugin binary as subrecord fields (e.g., `FULL` for names,
`DESC` for descriptions) rather than referencing an external string table.

The export reads the original mod's ESP/ESM file from the server, walks
all records that have a translation in the database, and rewrites the
corresponding subrecord fields with the translated text. The result is a
binary-compatible ESP that players drop into their `Data\` folder.

**Compatibility warning:** The patched ESP is derived from the _original_
mod file snapshot stored at import time. If the mod author releases an
update, your patched ESP will be based on the old version. Always
re-import the updated mod and redo the export after a mod update.

---

## BA2 Archive (Fallout 4 / Fallout 76)

The tool can pack the generated STRINGS files into a `.ba2` archive,
which is the format Fallout 4 and Fallout 76 use for mod assets.

The generated BA2 uses the standard Fallout 4 naming convention:

```
{PluginStem} - Main.ba2
```

For example, for `MyMod.esp` the archive will be named `MyMod - Main.ba2`.

Inside the archive, STRINGS files are stored at the path
`Strings\{filename}` (e.g., `Strings\MyMod_uk.STRINGS`).

The game automatically loads BA2 archives that follow the
`{PluginStem} - {Name}.ba2` naming scheme when the associated ESP is
active in the load order. The exported BA2 is an uncompressed GNRL-type
archive (version 1) for maximum compatibility across all game versions
and mod managers.

---

## Langpack ZIP

A langpack is a ZIP containing only translation delta files — no BA2 archive.
Only **changed or new** artifacts are included:

- `Strings\*.STRINGS` / `*.DLSTRINGS` / `*.ILSTRINGS` — only tables where at least one string differs from source;
- patched ESP/ESM — only when the binary differs from the imported original;
- `Scripts\*.pex` — only scripts with translated string literals.

**Disco Elysium** uses the same Langpack ZIP action. The zip is a Final Cut
pack: updated `.po` files plus localized `Audio/*.wav` when voice was
synthesized. There is no STRINGS / ESP / BA2 path for that game. Exported
`.po` keeps ASCII `"…"` (saves fold `«»`); `--`, `*italics*`, and `'title'`
should still match the English lockit. Synthesized WAVs already omit
narration when audio-intel cut the line to quotes — see
[Voice](09-voice.md#disco-what-gets-spoken).

Naming:

```
{PluginStem}_{targetLang}_langpack.zip (e.g., MyMod_uk_langpack.zip)
```

---

## Full Localized Mod (ZIP)

The full localized mod ZIP is the mod-manager-friendly release bundle. It contains:

- a BA2/BSA archive with STRINGS and PEX;
- a patched ESP when the mod has non-localized embedded text.

Naming:

```
{PluginStem}_{targetLang}.zip (e.g., MyMod_uk.zip)
```

The ZIP is generated in **store mode** (no compression) because BA2 and ESP
files are already binary-packed.

**Note:** No `README.txt` is included automatically. Add installation
instructions before uploading to Nexus Mods or sharing with players.

---

## BSA Archive (Skyrim SE / LE / Fallout 3 / Fallout NV)

For Skyrim SE, Skyrim LE, Fallout 3, and Fallout: New Vegas mods, the tool
packs translated STRINGS files into a `.bsa` archive instead of a BA2.

The generated BSA uses the standard Skyrim naming convention:

```
{PluginStem} - Strings.bsa
```

For example, for `MyMod.esp` the archive will be named `MyMod - Strings.bsa`.

Inside the archive, STRINGS files are stored at `Strings\{filename}`,
identically to BA2 archives. The tool writes BSA v105 (Skyrim SE format)
archives with uncompressed data blocks for maximum compatibility.

The export format is selected **automatically** based on the game type
stored with the mod. Fallout 4 and Fallout 76 mods produce BA2; Skyrim SE/LE,
Fallout 3, and Fallout: New Vegas mods produce BSA. No manual selection is needed.

---

## Triggering an Export

Export is available from the **⋯ menu** on each mod row in the **Mods** list.

1. Open the Mods list for the target game.
2. Ensure the workspace **Source language** and **Target language** are set correctly.
3. Click **⋯** on the mod row and choose an export option.

| Menu item              | What downloads                                            |
| ---------------------- | --------------------------------------------------------- |
| **Export translation** | Langpack ZIP: changed STRINGS, ESP, PEX only (no BA2)     |
| **Full localized mod** | Full mod ZIP: BA2/BSA archive (+ patched ESP when needed) |

While the server builds the archive, an export job appears in the Jobs list.

---

## What to Include in a Mod Release

| Mod type                                | Minimum release    | Recommended release             |
| --------------------------------------- | ------------------ | ------------------------------- |
| Localized (uses external string tables) | Langpack ZIP       | Full localized mod (BA2 in ZIP) |
| Non-localized (text in ESP)             | Langpack ZIP (ESP) | Langpack ZIP (ESP)              |
| Mixed (both)                            | Langpack ZIP       | Full localized mod              |

Practical checklist before publishing:

1. **Test in-game** — load the translation in Fallout 4 or Skyrim SE
   before publishing. Look for encoding issues, text overflow, and
   placeholder corruption.
2. **Include installation instructions** — tell players where to place
   the files. A mod manager (Vortex, NMM, MO2) FOMOD installer is ideal
   for complex setups.
3. **Credit the original mod author** — translations are derivative
   works. Always link the original mod page and credit the author.
4. **Declare the base mod version** — state which version of the mod your
   translation is based on, so players know if it's outdated.
5. **Use descriptive tags** — on Nexus Mods, tag the translation file
   with the target language for discoverability.

---

## Partial Exports and Drafts

You can export at any stage — even if not all strings are translated.
Untranslated strings will use the original English (or base language) text
as a fallback.

The export queries use `COALESCE(translation, source_text)` as the
fallback: for every string slot, if a translation exists in the database
it is used; if not, the original source text is written instead. No
string slot in the output file is left blank.

When multiple translations exist for one string (different statuses or
attempts), the best available is chosen by quality priority:
`reviewed` > `human` > `draft` > `tm` > `fuzzy` > `auto` > `rejected`.

**Recommendation:** export a draft early and load it in-game before the
translation is complete. This lets you spot layout issues, broken
placeholders, and missing context while most of the original English
text is still in place as a fallback. Much easier to fix early.

---

## Export Invariants

The current export pipeline is regression-tested against a small **golden
corpus** of canonical STRINGS, DLSTRINGS, and ILSTRINGS files.

These tests assert the following invariants:

1. **File inventory is preserved.** If the source localized mod contains
   three string tables, the export produces the same three tables. The
   basename stays the same and only the locale suffix changes.
2. **Unknown IDs are ignored.** A translation row for an ID that does not
   exist in the source file is not injected into the output.
3. **Missing translations fall back to source text.** Untranslated slots
   keep the original source text instead of becoming blank.
4. **UTF-8 text survives round-trip.** Non-ASCII text is preserved when the
   tool writes `.strings`, `.dlstrings`, `.ilstrings`, and BA2 output.
5. **BA2 output is structurally predictable.** Exported archives contain
   only the generated strings tables under `Strings\` and keep the expected
   Fallout 4 archive naming pattern.

This corpus is intentionally synthetic and compact so it can run in the normal
test suite quickly. It is a regression safety net, not a substitute for
in-game validation on real mods.

---

← [Voice](09-voice.md) | [Home](README.md) | **Next: [Diff & Re-import →](11-diff-and-reimport.md)**
