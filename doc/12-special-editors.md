# 12 — Special Editors

The pipeline includes four specialised tools for specific types of content
that need more than a simple text box.

---

## Table of Contents

- [INNR Editor — Instance Naming Rules](#innr-editor--instance-naming-rules)
- [Book / HTML Editor](#book--html-editor)
- [BA2 Archive Browser](#ba2-archive-browser)
- [ESP Raw Record Explorer](#esp-raw-record-explorer)

---

## INNR Editor — Instance Naming Rules

**Route:** `/mods/:id/innr`

Instance Naming Rules (INNR records) control how the game generates dynamic
item names — for example, how a weapon's name changes based on attached mods:

> "Combat Rifle" → "Powerful Automatic Combat Rifle"

The INNR editor shows all naming rules grouped by base EDID,
letting you translate each name slot inline.

### Opening the INNR Editor

From the Mod Editor page, click the **INNR Editor** button (or navigate
directly to `/mods/:id/innr`).

> TODO: Screenshot of the INNR editor page.

### Reading the INNR Grid

| Column | Description |
|--------|-------------|
| Slot | Position in the naming rule (prefix, noun, suffix…) |
| EDID | Base Editor ID of the naming rule |
| Source | Original English name fragment |
| Translation | Your translated name fragment |

### Editing Name Slots

Click any row to edit the Translation cell inline.
Press **Enter** to save, **Escape** to cancel.

> TODO: Describe auto-save behaviour.
> Explain how slots combine to form the final item name (show a worked example).
> Describe target language selector.

---

## Book / HTML Editor

**Access:** Click the `📖 Book editor` button in the Detail Panel when
a `BOOK` record is selected (or any record containing HTML markup).

In-game books use basic HTML tags for formatting (bold, italic, paragraph breaks,
font tags, etc.). The Book Editor provides a **split-pane preview** so you can
write the translation while seeing how it will look in-game.

### Left Panel: Source

Displays the original English book text — read-only.
Toggle between **Raw** (HTML source) and **Preview** (rendered).

### Right Panel: Translation

Editable field for your translation.
Toggle between **Raw** (HTML source) and **Preview** (rendered).

The preview uses the Pip-Boy dark theme (dark green background, terminal font),
matching the in-game appearance.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | Save and close |
| `Escape` | Close without saving |

### Tips

> TODO:
> - Keep HTML tags intact — only translate the text between tags.
> - Use the preview to check line lengths (long lines may not wrap correctly in-game).
> - Font tags with `face=` attribute control the Pip-Boy font — do not translate these.
> - `<br>` and `<p>` tags control spacing — preserve them.

---

## BA2 Archive Browser

**Route:** `/ba2-browser`

The BA2 Browser lets you inspect the contents of any BA2 archive imported
alongside a mod, without extracting it.

### Using the Browser

1. Select a BA2 archive from the dropdown.
2. Browse the file tree — folders and files are shown hierarchically.
3. Click a file to preview its content (text files shown inline; images rendered).

> TODO: Screenshot of the BA2 browser page.
> List what file types can be previewed (`.txt`, `.json`, `.png`, `.dds`, etc.).
> Explain which archives are available (only those uploaded with mods).

### What to Look For

- `Interface/` — MCM configuration files (`.json`, `.txt`)
- `Scripts/` — compiled Papyrus scripts (`.pex`)
- `Textures/` — image assets (usually not translated, but useful for context)

---

## ESP Raw Record Explorer

**Route:** `/esp-explorer`

The ESP Explorer is a low-level tool for examining the raw binary record
structure of any imported mod plugin.

Use this when you need to understand record relationships, inspect raw field
values, or debug unusual strings that don't appear in the normal editor.

### Using the Explorer

1. Select a mod from the dropdown.
2. The left sidebar shows all record types (GRUPs) with record counts.
3. Click a GRUP to list its records in the right panel.
4. Use the search bar to filter by FormID, EDID, or field content.
5. Click a record row to expand it and see all subrecords with hex and text views.

> TODO: Screenshot of the ESP explorer two-panel layout.

### Reading the Record Table

| Column | Description |
|--------|-------------|
| FormID | Unique record identifier in hex |
| Type | Record signature (e.g. `DIAL`, `INFO`, `NPC_`) |
| Flags | Status flags: LOC (localised), CMPRS (compressed), DEL (deleted), MASTER |
| EDID | Editor ID (if present in the record) |

### Record Flags

| Flag | Meaning |
|------|---------|
| **LOC** | Record uses external STRINGS files (its strings will appear in the editor) |
| **CMPRS** | Record data is zlib-compressed (decompressed automatically for viewing) |
| **DEL** | Record is marked as deleted (usually safe to ignore) |
| **MASTER** | Record is a master record override |

---

← [Diff & Re-import](11-diff-and-reimport.md) | [Home](README.md) | **Next: [Dashboard →](13-dashboard.md)**
