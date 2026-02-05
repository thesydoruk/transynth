# 11 — Diff & Re-import

When a mod author releases an update, use the Diff tool to see what changed
and carry over your existing translations to the new version.

---

## Table of Contents

- [Why Re-import?](#why-re-import)
- [How the Diff Works](#how-the-diff-works)
- [The Diff Page](#the-diff-page)
  - [Selecting Two Versions](#selecting-two-versions)
  - [Reading the Diff Table](#reading-the-diff-table)
  - [Change Types](#change-types)
- [Carrying Over Translations](#carrying-over-translations)
- [The ReimportModal](#the-reimportmodal)
- [After Re-import](#after-re-import)
- [Tips](#tips)

---

## Why Re-import?

Mods are updated regularly — the author may fix bugs, add content, or
rebalance dialogue.
When you re-import an updated version, you don't want to lose the translations
you've already completed.

The pipeline detects that a newer version of a mod is already in the database
and offers to **carry over** translations from the old version to matching
strings in the new version.

---

## How the Diff Works

The diff compares two versions of the same mod by **FormID + field path**.

For each string in the new version, the tool looks for a matching string in
the old version.
If found, it compares the source text:

- **Unchanged** — source text is identical → translation can be safely carried over.
- **Changed** — source text is different → translation may need review.
- **Added** — new string not present in old version → needs translation.
- **Removed** — old string no longer present in new version → translation archived.

---

## The Diff Page

Navigate to **Diff** in the top navigation bar (route: `/diff`).

### Selecting Two Versions

> TODO: Describe the two mod selectors (Old Version, New Version).
> Both selectors show all imported mods — select the old and new versions
> of the same mod.
> Click "Compare" to run the diff.
> Screenshot placeholder.

### Reading the Diff Table

> TODO: Describe the diff table columns:
> - Change type badge (Added / Removed / Changed / Unchanged)
> - FormID
> - GRUP / Field
> - EDID
> - Old source text
> - New source text
> - Existing translation (if any)
> Screenshot placeholder.

### Change Types

| Badge | Colour | Meaning |
|-------|--------|---------|
| **Added** | Green | New string in the updated mod |
| **Removed** | Red | String deleted from the updated mod |
| **Changed** | Yellow | Source text modified — translation may be outdated |
| **Unchanged** | Grey | Source text identical — translation carries over safely |

---

## Carrying Over Translations

After reviewing the diff, click **Carry Over** to copy translations from
the old version to the new version's matching strings.

Rules:
- Only **Unchanged** strings receive the translation automatically.
- **Changed** strings receive the old translation with status **Draft**,
  flagged for review.
- **Added** strings start with status **Empty**.

> TODO: Confirm carry-over rules from `src/web/modImportService.ts` or the
> relevant source.

---

## The ReimportModal

If you import a mod that already has an older version in the database,
the tool automatically shows the **ReimportModal** dialogue.

The modal prompts you to:
1. Confirm that the new file is an updated version of the existing mod.
2. Choose whether to carry over translations immediately.

> TODO: Describe the modal's Yes/No/Skip options.
> Screenshot placeholder.

---

## After Re-import

After carrying over translations:

1. Open the new version in the editor.
2. Filter by **Status = Draft** to find strings with changed source text.
3. Review and update each translation as needed.
4. Run the TM waterfall to catch any strings that match other mods.
5. Run QA to catch placeholder issues introduced by source text changes.

---

## Tips

> TODO:
> - Always diff before discarding the old mod version from the database.
> - Use the filter (Change Type = Changed) to focus only on what needs attention.
> - Unchanged strings with status Approved remain Approved after carry-over.
> - A complete re-import workflow typically takes minutes even for large mods.

---

← [TMX Exchange](10-tmx.md) | [Home](README.md) | **Next: [Special Editors →](12-special-editors.md)**
