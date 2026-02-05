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

| Format | File | Purpose |
|--------|------|---------|
| **STRINGS** | `.strings`, `.dlstrings`, `.ilstrings` | External string table files read by the game engine |
| **Patched ESP** | `.esp` / `.esm` | Mod plugin with translations embedded directly |
| **BA2 Archive** | `.ba2` | Archive containing translated STRINGS files and/or assets |
| **Project ZIP** | `.zip` | All of the above bundled for distribution |

---

## STRINGS Files

Fallout 4 loads string data from binary table files alongside the mod plugin.
A typical translation release contains:

```
MyMod_en.STRINGS
MyMod_en.DLSTRINGS
MyMod_en.ILSTRINGS
```

> TODO: Explain the three file types:
> - `.STRINGS` — generic string table
> - `.DLSTRINGS` — dialogue strings (with length prefix)
> - `.ILSTRINGS` — info/internal strings (with length prefix)
> Explain where players put these files (Data/Strings/).
> Note that only strings that use external string tables are exported this way;
> some fields are embedded directly in the ESP.

---

## Patched ESP

An alternative to STRINGS files is to write the translations directly into
a copy of the ESP/ESM plugin.

> TODO: Explain when this is useful (mods that don't use external STRINGS,
> or when distributing a standalone translated ESP).
> Warn about patched ESP compatibility with mod updates.

---

## BA2 Archive

The tool can pack the generated STRINGS files into a `.ba2` archive,
which is the format Fallout 4 uses for mod assets.

> TODO: Explain BA2 archive naming convention (e.g. `MyMod - Main.ba2`).
> Explain that the game loads BA2s listed in the plugin's archive entries.
> Describe the BA2 export option in the UI.

---

## Project ZIP

The Project ZIP bundles:
- The patched ESP (optional)
- The STRINGS files (or BA2 archive containing them)
- A `README.txt` with installation instructions (generated automatically)

> TODO: Describe how to generate the ZIP.
> Describe the generated README.txt contents.
> Explain that this ZIP is ready to upload to Nexus Mods.

---

## Triggering an Export

> TODO: Describe the Export button / section in the Mod Editor or Mod List:
> 1. Open the mod in the editor (or select it from the Mods list).
> 2. Click "Export".
> 3. Choose format(s): STRINGS / ESP / BA2 / ZIP.
> 4. Choose target language.
> 5. Click "Generate" and wait.
> 6. Download the file(s).
> Screenshot placeholder.

---

## What to Include in a Mod Release

> TODO: Practical guidance for publishing a translation on Nexus Mods:
> - Minimum: STRINGS files or patched ESP.
> - Recommended: BA2 archive for large mods.
> - Always include installation instructions.
> - Credit original mod author.
> - Test in-game before publishing.

---

## Partial Exports and Drafts

You can export at any stage — even if not all strings are translated.
Untranslated strings will use the original English (or base language) text
as a fallback.

> TODO: Explain the fallback mechanism.
> Recommend exporting a draft early for in-game testing even before full translation.

---

← [Glossary](08-glossary.md) | [Home](README.md) | **Next: [TMX Exchange →](10-tmx.md)**
