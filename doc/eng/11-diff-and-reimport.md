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
- [Pre-release Checklist](#pre-release-checklist)
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

When the current filter yields no rows, the page now shows an action-first empty state with immediate next steps:

- **Show all changes** — resets the filter to `all`
- **Open current game hub** (or games catalogue if no game context is persisted)

### Selecting Two Versions

The Diff page has two mod dropdowns:

- **New Version** — the freshly imported (updated) mod.
- **Old Version** — the previous version you translated.

Both dropdowns list every mod currently in the database, so you can
compare any two mods — they don't have to share the same name.

If you navigate to the Diff page from the
[ReimportModal](#the-reimportmodal) or from the **Update Mod** button
in the editor, both selectors are pre-filled automatically from URL
parameters (`?newModId=X&oldModId=Y`) and the comparison runs immediately
on page load.

Otherwise, select the two mods manually and click **Compare**.
The button label changes to "Comparing…" while the request is in flight.

### Reading the Diff Table

After the comparison runs, a summary row of coloured chips shows the
total count for each change category. Clicking a chip (except
**Unchanged**) filters the table to that category. Below the summary,
the diff table has the following columns:

| Column          | Content                                                   |
| --------------- | --------------------------------------------------------- |
| **Change**      | Badge: `added` / `removed` / `changed`                    |
| **FormID**      | 8-digit hex FormID of the record                          |
| **Type**        | Record group signature (e.g., `NPC_`, `WEAP`, `DIAL`)     |
| **Source EN**   | The source text of the string in this version             |
| **Translation** | Existing translation (from whichever side has it), or `—` |
| **Status**      | Translation status badge                                  |

> **Note:** Unchanged strings are **not** listed in the table — they
> are only counted in the summary chip (`Unchanged: N`). The table
> exclusively shows strings that differ (added, removed, or changed).

### Change Types

| Badge         | Colour | Meaning                                                 |
| ------------- | ------ | ------------------------------------------------------- |
| **Added**     | Green  | New string in the updated mod                           |
| **Removed**   | Red    | String deleted from the updated mod                     |
| **Changed**   | Yellow | Source text modified — translation may be outdated      |
| **Unchanged** | Grey   | Source text identical — translation carries over safely |

---

## Carrying Over Translations

After reviewing the diff, click **Carry Over** to copy translations from
the old version to the new version's matching strings.

Rules:

- Only **Unchanged** strings receive the translation automatically.
- **Changed** strings receive the old translation with status **Draft**,
  flagged for review.
- **Added** strings start with status **Empty**.

Verified carry-over behaviour from `src/web/queries.ts`
(`carryOverTranslations`):

| String situation                  | What happens                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| **Unchanged** source text         | Translation copied to new version with its **original status** (reviewed, human, draft, etc.) |
| **Changed** source text           | Translation copied to new version with status forced to **`draft`**                           |
| **Added** (not in old version)    | No carry-over; string starts with status `empty` / untranslated                               |
| Already translated in new version | **Skipped** — carry-over never overwrites an existing translation                             |

After the carry-over completes, the result summary is shown inline:

```
Carried: 820 · Needs review: 43 · Skipped: 12
```

- **Carried** — strings where source was unchanged; translation applied with original status.
- **Needs review** — strings where source changed; translation applied as `draft`.
- **Skipped** — strings already translated in the new version or absent from the old version.

When there are strings that need review, an **Open in Editor (N drafts)**
link appears next to the summary, taking you directly to the new mod's
editor pre-filtered to `status=draft`.

---

## Pre-release Checklist

After a comparison has loaded, the Diff page now shows a **Pre-release checklist**.
It keeps the post-import workflow on one surface by summarising the current state of the new mod:

- **Coverage** — translated strings versus total strings in the new version
- **Drafts** — strings still needing manual review after carry-over
- **QA issues** — active QA blockers still open on the new mod

The checklist tracks these steps:

1. Comparison completed
2. Carry-over executed
3. Drafts reviewed
4. QA issues resolved
5. Translation coverage completed
6. Editor opened for final export

When something is still pending, the checklist provides direct next-action links:

- **Review drafts** → opens the new mod editor with `?status=draft`
- **Fix QA issues** → opens the new mod editor with `?qaOnly=1`
- **Continue translating in editor** → opens the new mod editor without filters
- **Open editor for export** → returns to the editor toolbar once the checklist is clear

The checklist also includes a **Recent handoff activity** block for the selected mod.
It shows the latest mod-specific actions recorded in the audit log and includes
an **Open full activity log** link that jumps to **Settings → Activity** with
the current mod filter already applied.

---

## The ReimportModal

If you import a mod that already has an older version in the database,
the tool automatically shows the **ReimportModal** dialogue.

The modal prompts you to:

1. Confirm that the new file is an updated version of the existing mod.
2. Choose whether to carry over translations immediately.

If you upload a mod whose name matches a mod already in the database
(same filename stem, different file hash), the tool automatically
shows the **ReimportModal** after the import job finishes.

The modal displays a list of all previous versions of that mod, each
showing:

- The mod name
- The date it was imported
- Its total string count
- Its translation completion percentage

If only one previous version exists, it is pre-selected. If several
exist, click the desired row to select it.

Two action buttons are available:

| Button        | Action                                                                        |
| ------------- | ----------------------------------------------------------------------------- |
| **Open Diff** | Navigates to `/diff?newModId=X&oldModId=Y`; the comparison runs automatically |
| **Skip**      | Dismisses the modal without any carry-over                                    |

You can also close the modal by clicking the **✕** button or clicking
outside it. Skipping or closing is safe — you can always open the Diff
page manually at any time to carry over translations later.

---

## After Re-import

After carrying over translations:

1. Use the **Pre-release checklist** on the Diff page to see current blockers immediately.
2. Open the new version in the editor.
3. Filter by **Status = Draft** to find strings with changed source text.
4. Review and update each translation as needed.
5. Run the TM waterfall to catch any strings that match other mods.
6. Run QA to catch placeholder issues introduced by source text changes.
7. Return to the editor toolbar to export STRINGS, BA2, or ZIP when the checklist is clear.

---

## Tips

- **Always diff before deleting the old mod version.** Once an old mod
  is removed from the database, its translations can no longer be
  carried over.
- **Focus on the Changed category.** Click the orange `changed` chip
  in the summary bar to filter the table to only modified strings.
  These are the only ones that require manual review after carry-over.
- **Unchanged strings keep their original status.** If a string was
  `reviewed` in the old version and the source text didn't change, it
  remains `reviewed` in the new version — no re-approval needed.
- **Use the "Open in Editor" shortcut.** After carry-over, if there are
  draft strings, a direct link appears on the Diff page that opens the
  new mod's editor pre-filtered to `status=draft`.
- **Run QA after carry-over.** Changed-source strings carry the old
  translation as a `draft`. Placeholders, length, and terminology may
  have shifted — run QA to catch those issues quickly.

---

← [TMX Exchange](10-tmx.md) | [Home](README.md) | **Next: [Special Editors →](12-special-editors.md)**
