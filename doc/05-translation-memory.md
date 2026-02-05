# 05 — Translation Memory

The Translation Memory (TM) lets you reuse translations from previous work
automatically, reducing repetitive effort and improving consistency.

---

## Table of Contents

- [What is the Translation Memory?](#what-is-the-translation-memory)
- [The 5-Method Waterfall](#the-5-method-waterfall)
  - [1. Anchor Match](#1-anchor-match)
  - [2. EDID Match](#2-edid-match)
  - [3. Text-Norm Match](#3-text-norm-match)
  - [4. Punct-Norm Match](#4-punct-norm-match)
  - [5. Fuzzy Match](#5-fuzzy-match)
- [Numeric-Invariant Matching](#numeric-invariant-matching)
- [Auto-Apply on Import](#auto-apply-on-import)
- [Manually Applying TM Suggestions](#manually-applying-tm-suggestions)
- [TM Suggestions Tab in the Detail Panel](#tm-suggestions-tab-in-the-detail-panel)
- [How Translations Enter the TM](#how-translations-enter-the-tm)
- [Sharing the TM: TMX Export/Import](#sharing-the-tm-tmx-exportimport)

---

## What is the Translation Memory?

A Translation Memory is a database of previously translated string pairs:
`(source text) → (translation)`.

When you import a new mod, the pipeline checks every source string against
the TM. If a match is found, the translation is auto-filled, saving you
from re-translating identical or near-identical text.

The TM grows over time as you translate more mods.

---

## The 5-Method Waterfall

Matching is attempted in order from most precise to most fuzzy.
The first method that finds a match wins; subsequent methods are skipped.

### 1. Anchor Match

An exact match on **FormID + EDID + field name** across mods.
This is the most reliable method — same record in a different mod version.

> TODO: Explain when anchor matches occur (e.g. shared DLC records, patches).

### 2. EDID Match

Match on **EDID + field name**, ignoring FormID.
Useful when a mod changes FormIDs between versions but keeps the same Editor IDs.

> TODO: Example: `DLC01_Scene01.FULL` matching across two mod versions.

### 3. Text-Norm Match

Match on **normalised source text** (whitespace collapsed, case-normalised).
Small formatting differences don't prevent a match.

> TODO: Example: "Hello,  World!" matching "Hello, World!".

### 4. Punct-Norm Match

Match on source text with **punctuation stripped**.
Handles differences in trailing punctuation between mod versions.

> TODO: Example: "Ready?" vs "Ready" matching the same translation.

### 5. Fuzzy Match

Match using **trigram similarity** (PostgreSQL `pg_trgm`).
Strings that are very similar but not identical can still get a partial match.
The similarity score is shown in the TM Suggestions tab.

> TODO: Describe the minimum similarity threshold (default value).
> Explain how fuzzy matches are ranked.

---

## Numeric-Invariant Matching

Numbers in source strings (amounts, levels, percentages) can vary between
mod versions (e.g. "Deal 10 damage" → "Deal 15 damage").

The pipeline can match such strings by treating numbers as wildcards,
then substituting the new numbers into the matched translation.

> TODO: Give a worked example. Explain when this is applied.

---

## Auto-Apply on Import

When you import a mod, the pipeline automatically runs the TM waterfall
for every string and fills any matched translations.

Strings filled this way receive the status **TM**.
You can review and approve them in the editor.

---

## Manually Applying TM Suggestions

If a string has no auto-filled translation, you can still apply a TM
suggestion from the Detail Panel:

1. Select the string in the grid.
2. Click the **TM Suggestions** tab in the Detail Panel.
3. Click **Apply** next to a suggestion to copy it into the translation field.
4. Edit if needed, then save with **Ctrl+S**.

You can also trigger re-matching for the entire mod (or a filtered set of strings)
using the batch **Apply TM** action.

---

## TM Suggestions Tab in the Detail Panel

The TM Suggestions tab shows up to 5 candidates for the current string,
sorted by match score descending.

| Column | Description |
|--------|-------------|
| Score | Similarity score (0–100%) |
| Method | Which waterfall method produced the match |
| Source | Matched source text |
| Translation | The suggested translation |
| Mod | Which mod this translation came from |

> TODO: Screenshot placeholder.
> Explain "Apply" button behaviour (copies into field, sets status to TM).

---

## How Translations Enter the TM

Every time you save a translation (status Draft, Approved, or TM), it is
added to the TM automatically.

Imported translations — from EET files, CSV, or TMX — also populate the TM.

> TODO: Explain deduplication policy (same source + same translation).

---

## Sharing the TM: TMX Export/Import

You can export the full TM (or a per-mod subset) as a TMX 1.4b file
compatible with Trados, memoQ, OmegaT, and other CAT tools.

You can also import a TMX file produced by another tool to populate the TM.

See [TMX Exchange](10-tmx.md) for details.

---

← [Keyboard Shortcuts](04-keyboard-shortcuts.md) | [Home](README.md) | **Next: [LLM Translation →](06-llm-translation.md)**
