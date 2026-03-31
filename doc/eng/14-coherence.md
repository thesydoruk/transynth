# 14 — Coherence Checker

Find and fix inconsistencies where the same source text is translated
in multiple different ways.

---

## Table of Contents

- [What is Coherence?](#what-is-coherence)
- [Opening the Coherence Checker](#opening-the-coherence-checker)
- [Reading the Results](#reading-the-results)
- [Fixing Inconsistencies](#fixing-inconsistencies)
- [When to Run the Coherence Checker](#when-to-run-the-coherence-checker)

---

## What is Coherence?

A translation is **coherent** when the same source phrase always produces
the same translation throughout the mod (and ideally across all mods).

Incoherence looks like:

- "Take care, wanderer." translated as "Бережись, мандрівнику." in one place
  and "Обережно, мандрівнику." in another.
- NPC name "Paladin Danse" translated differently in two dialogue lines.

Inconsistencies confuse players and signal a low-quality translation.

---

## Opening the Coherence Checker

Navigate to **Coherence** in the top navigation bar (route: `/coherence`).

If no inconsistency groups are found, the page provides direct actions instead of only passive text:

- **Refresh check** — re-runs the coherence query
- **Open Review Queue** — jumps into quality-review workflow immediately

---

## Reading the Results

The coherence checker lists **source strings that have more than one distinct
translation** across the database.

Use the **Language** dropdown at the top to select which target language to
check. The page reloads automatically on language change.

Results are shown as **collapsible group cards**, paginated at 30 groups per
page. Groups are ordered by **variant count descending** — the most conflicted
source strings appear first.

Each card header shows:

- The **source text** of the conflicting string
- A badge indicating **how many distinct translations** exist for it
  (e.g. `2 variants`)

Click the header to expand the group. Inside you will see one
**variant card** per distinct translation, sorted by popularity
(most-used variant first). Each variant card shows:

| Item                    | Description                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| **Translation text**    | The actual translated string for this variant                                               |
| **Apply to All** button | Propagates this translation to every string in the group                                    |
| String list             | Each string using this variant: mod name, EDID, record signature + path, and current status |

---

## Fixing Inconsistencies

1. Click any group header to expand it and see all variant cards.
2. Read the string list under each variant to understand where each
   version comes from (which mod, which record).
3. Decide which translation is correct.
4. Click **Apply to All** on the desired variant.

The **Apply to All** action calls `POST /api/coherence/resolve` with the
chosen `translation` and the group's `text_norm` key. The server updates
every string in that group that uses a _different_ translation —
strings that already use the chosen variant are left untouched. The
mutation is applied with the best-quality-available status for each
updated string.

After a successful resolve:

- The coherence list is re-fetched and the resolved group disappears.
- QA issue counts and the strings list in the editor are invalidated so
  any `duplicate_inconsistency` warnings clear automatically.

If you prefer to fix individual strings manually, note the mod name and
record info shown in the variant card, then navigate to that mod in the
editor and search for the string by EDID or source text.

---

## When to Run the Coherence Checker

- **Before exporting a final release.** Incoherent translations will be
  noticed by players immediately. A clean coherence report means your
  terminology is consistent across the whole mod.
- **After LLM batch translation.** The LLM may produce slightly different
  phrasing for identical source strings when they appear in different
  contexts. Coherence will surface all such cases.
- **After importing a TMX from another translator.** Their wording may
  differ from your established style. Resolve conflicts before merging.
- **After a carry-over from a mod update.** Source text changes can
  invalidate previously coherent translations.
- **For large mods, start from page 1.** The list is sorted by variant
  count descending, so the most widespread inconsistencies appear first
  and are the most impactful to fix.

---

← [Dashboard](13-dashboard.md) | [Home](README.md) | **Next: [Review Queue →](15-review-queue.md)**
