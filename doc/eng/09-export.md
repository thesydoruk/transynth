# 09 — Exporting

Create the translation files that players install to play the mod in your language.

---

## Table of Contents

- [Export Formats](#export-formats)
- [STRINGS Files](#strings-files)
- [Patched ESP](#patched-esp)
- [BA2 Archive](#ba2-archive)
- [Project ZIP](#project-zip)
- [Triggering an Export](#triggering-an-export)
- [What to Include in a Mod Release](#what-to-include-in-a-mod-release)
- [Partial Exports and Drafts](#partial-exports-and-drafts)

---

## Export Formats

The pipeline can produce four types of output:

| Format          | File                                   | Purpose                                                              |
| --------------- | -------------------------------------- | -------------------------------------------------------------------- |
| **STRINGS**     | `.strings`, `.dlstrings`, `.ilstrings` | External string table files read by the game engine                  |
| **Patched ESP** | `.esp` / `.esm`                        | Mod plugin with translations embedded directly                       |
| **BA2 Archive** | `.ba2`                                 | Fallout 4/76 archive containing translated STRINGS files             |
| **BSA Archive** | `.bsa`                                 | Skyrim SE/LE and FO3/FNV archive containing translated STRINGS files |
| **Project ZIP** | `.zip`                                 | All of the above bundled for distribution                            |

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

| Extension    | Format                                        | Usage                                               |
| ------------ | --------------------------------------------- | --------------------------------------------------- |
| `.STRINGS`   | Null-terminated UTF-8 strings                 | Generic text: item names, book titles, descriptions |
| `.DLSTRINGS` | uint32 length prefix + text + null terminator | Dialogue text shown in conversation menus           |
| `.ILSTRINGS` | Same binary layout as DLSTRINGS               | NPC topics, Pip-Boy notes, internal info strings    |

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

The **Export BA2** and **Export ZIP** buttons in the Mod Editor toolbar
both generate a BA2 archive. The ZIP variant bundles the BA2 together
with a patched ESP (if applicable) into a single distributable file.

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

## Project ZIP

The Project ZIP bundles:

- The patched ESP (optional)
- The STRINGS files (or BA2 archive containing them)
- A `README.txt` with installation instructions (generated automatically)

Click **Export ZIP** in the Mod Editor toolbar. The server generates the
ZIP on the fly and the browser downloads it automatically.

ZIP file naming:

```
{PluginStem}_{targetLang}.zip    (e.g., MyMod_uk.zip)
```

The ZIP is generated in **store mode** (no compression), because BA2 and
ESP files are already binary-packed and don't benefit from further
compression.

**Note:** No `README.txt` is included in the ZIP automatically. Add
your own installation instructions before uploading to Nexus Mods or
sharing with players.

---

## Triggering an Export

All export buttons are located in the **Mod Editor toolbar** at the top
of the editor page (`/editor/:modId`).

1. Open the mod in the editor by clicking its name in the Mods list.
2. Ensure the correct **Source language** and **Target language** are
   selected in the toolbar dropdowns. The export uses these values.
3. Click one of the four export buttons:

| Button             | What downloads                                                          |
| ------------------ | ----------------------------------------------------------------------- |
| **Export STRINGS** | Raw `.STRINGS`, `.DLSTRINGS`, `.ILSTRINGS` files (one per string table) |
| **Export ESP**     | Patched plugin file with embedded translations                          |
| **Export BA2**     | A single archive (`.ba2` for FO4 or `.bsa` for SSE) containing STRINGS  |
| **Export ZIP**     | A `.zip` bundle: archive + patched ESP (whichever applies)              |

4. The file downloads immediately via the browser once the server
   finishes generating it. The button label changes to "Exporting…" while
   the request is in flight.

---

## What to Include in a Mod Release

| Mod type                                | Minimum release             | Recommended release                |
| --------------------------------------- | --------------------------- | ---------------------------------- |
| Localized (uses external string tables) | Loose STRINGS files         | BA2 archive (mod manager friendly) |
| Non-localized (text in ESP)             | Patched ESP                 | Patched ESP (same thing)           |
| Mixed (both)                            | STRINGS files + Patched ESP | Project ZIP (bundles both)         |

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

← [Glossary](08-glossary.md) | [Home](README.md) | **Next: [TMX Exchange →](10-tmx.md)**
