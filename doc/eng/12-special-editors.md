# 12 — Special Editors

The pipeline includes four specialised tools for specific types of content
that need more than a simple text box.

---

## Table of Contents

- [INNR Editor — Instance Naming Rules](#innr-editor--instance-naming-rules)
- [Book / HTML Editor](#book--html-editor)

---

## INNR Editor — Instance Naming Rules

**Route:** `/mods/:id/innr`

Instance Naming Rules (INNR records) control how the game generates dynamic
item names — for example, how a weapon's name changes based on attached mods:

> "Combat Rifle" → "Powerful Automatic Combat Rifle"

The INNR editor shows all naming rules grouped by base EDID,
letting you translate each name slot inline.

### Opening the INNR Editor

From the Mod Editor page, click the **INNR Editor** button in the toolbar
(visible only when the mod contains INNR records), or navigate directly
to `/mods/:id/innr`.

### Reading the INNR Grid

| Column      | Description                                         |
| ----------- | --------------------------------------------------- |
| Slot        | Position in the naming rule (prefix, noun, suffix…) |
| EDID        | Base Editor ID of the naming rule                   |
| Source      | Original English name fragment                      |
| Translation | Your translated name fragment                       |

### Editing Name Slots

Click any row to edit the Translation cell inline.
Press **Enter** to save, **Escape** to cancel.

**Auto-save behaviour:** translations are saved automatically when the
input field loses focus (blur) or when you press **Enter**. There is also
an explicit **Save** button on each row for manual confirmation.

- While the field has unsaved changes, the input border turns **orange** (dirty state).
- Immediately after a successful save it flashes **green**, then returns to neutral.
- Press **Escape** to discard the current change and revert to the last saved value.
- The **✕** button on a row clears its translation entirely.

**Target language:** use the **Language** dropdown at the top of the
page to switch between `uk` (Ukrainian), `ru`, `de`, `fr`, and `pl`.
The page reloads its data for the selected language automatically.

**How slots combine:** INNR records define component strings identified
by a numeric slot suffix in the EDID (e.g., `WeaponModType001`,
`WeaponModType002`). The game concatenates configured slot values at
runtime to build the final item name. For example:

| Slot   | Source       | Translation      |
| ------ | ------------ | ---------------- |
| 001    | Powerful     | Потужна          |
| 002    | Automatic    | Автоматична      |
| (base) | Combat Rifle | Бойова гвинтівка |

→ Final name: **Потужна Автоматична Бойова гвинтівка**

Because Slavic languages use grammatical agreement, all slots within the
same group must be translated together — that is why the INNR Editor
groups them by base EDID instead of mixing them into the main string list.

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

| Shortcut     | Action               |
| ------------ | -------------------- |
| `Ctrl+Enter` | Save and close       |
| `Escape`     | Close without saving |

### Tips

- **Only translate the text between tags** — copy the surrounding markup
  exactly as-is. For example: `<b>Vault</b>` → `<b>Сховище</b>`.
- **Never translate `font face=` attribute values.** The `face=` attribute
  selects the game's internal font resource — changing it will break rendering.
- **Preserve `<br>` and `<p>` tags for spacing.** In-game line breaks and
  paragraph gaps are controlled entirely by the markup, not by newlines.
- **Leave `<img src="img://...">` unchanged.** These are game-internal image
  references. The preview shows them as placeholder boxes; the game renders
  the actual asset.
- **Use the preview to check length.** Switch the right panel to **Preview**
  after writing a paragraph to verify that lines don't overflow the Pip-Boy
  reading frame. Long translated lines often exceed the original.
- **Toggle Raw / Preview independently** on each side. You can keep the
  source side in Preview (rendered) and the translation side in Raw
  (editable textarea) for a convenient side-by-side workflow.

---

← [Diff & Re-import](11-diff-and-reimport.md) | [Home](README.md) | **Next: [Dashboard →](13-dashboard.md)**
