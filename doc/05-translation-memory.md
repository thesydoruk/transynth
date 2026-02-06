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

An exact match on **FormID + field path** across mods (confidence: 0.95).
This is the most reliable method because it identifies the same logical record
replaced or overridden across mod versions.

Anchor matches occur when:

- A mod is updated and re-imported (same FormID, different mod record).
- A patch or compatibility mod overrides a record from a base mod.
- A DLC record is present in both the DLC ESM and a third-party patch.

The backend query joins on `records.formid_hex + records.path`, excluding the
current mod, then picks the translation with the highest-priority status
(`reviewed` > `human` > `tm` > `fuzzy` > `auto` > `draft`).

### 2. EDID Match

Match on **EDID + field path**, ignoring FormID (confidence: 0.85).
Useful when a mod changes FormIDs between versions but keeps the same Editor IDs.

Example: a record with `EDID = FortHagen_Terminal` and path `TERM.FULL` in mod
version 1.0 gets a new FormID in version 1.1. Because the EDID is stable,
the pipeline finds the existing translation via `records.edid + records.path`
even though the FormID changed.

EDID matching falls back to EDID-only (no path filter) and picks the
best-status translation.

### 3. Text-Norm Match

Match on **normalised source text** (confidence: 0.75).
Normalisation collapses all whitespace runs to a single space, converts to
lowercase, replaces all game-format placeholders with `¤PH¤`, and replaces
every number with `¤NUM¤`.

Example: the strings `"Hello,  World!"` and `"Hello, World!"` both normalise
to `"hello, world!"` and produce a match even though the original whitespace
differs.

Because numbers are replaced during normalisation, two strings whose only
difference is numeric values — such as `"Deal 10 damage"` and `"Deal 15 damage"`
— also share the same `text_norm`. When this happens the pipeline attempts to
transplant the new numbers into the existing translation automatically
(see [Numeric-Invariant Matching](#numeric-invariant-matching) below).

### 4. Punct-Norm Match

Match on source text with **all punctuation stripped** (confidence: 0.65).
Built on top of text-norm: first normalise (step 3), then remove every
non-word, non-placeholder, non-space character.

Example: `"Ready?"` normalises to `"ready?"`, then punctuation-strips to
`"ready"`. A string `"Ready"` normalises and strips identically. The pipeline
finds the match and reuses the existing translation.

The match is only considered when the `text_norm` column differs — identical
`text_norm` values are already caught by step 3.

### 5. Fuzzy Match

Match using **trigram similarity** (PostgreSQL `pg_trgm`).
Strings that are very similar but not identical can still get a partial match.
The similarity score is shown in the TM Suggestions tab.

The minimum threshold is controlled by PostgreSQL's `pg_trgm.similarity_threshold`,
which defaults to **0.3** (30%). The `%` operator used in the query only
returns rows above this threshold. Only strings of at least **4 characters**
are eligible for fuzzy matching.

Fuzzy candidates are ranked by **similarity score descending**, then by
translation status priority (`reviewed` > `human` > `tm` > `fuzzy` > `auto` > `draft`).
The single best candidate is applied during auto-import.

---

## Numeric-Invariant Matching

Numbers in source strings (amounts, levels, percentages) can vary between
mod versions (e.g. `"Deal 10 damage"` → `"Deal 15 damage"`).

The pipeline matches such strings by treating numbers as wildcards during
normalisation (replaced with `¤NUM¤`), then, when the raw texts differ,
transplanting the numbers from the new source into the existing translation.

**How it works (step by step):**

1. Both strings normalise to the same `text_norm` (numbers are `¤NUM¤`).
2. A text_norm match is found in the TM.
3. The raw texts are compared — they differ, meaning only the numbers changed.
4. `extractNumbers()` collects the ordered list of numbers from both raw strings.
5. `transplantNumbers()` replaces each old number in the matched translation with
   the corresponding new number, positionally.
6. A two-pass placeholder replacement prevents substring collisions
   (e.g. `"100"` → `"150"` without accidentally touching `"5"` inside `"150"`).
7. The transplanted translation is returned with confidence **0.70** and method `numeric`.

**Worked example:**

|                       | Text                                        |
| --------------------- | ------------------------------------------- |
| Old source            | `"Deal 10 damage and restore 5 health"`     |
| New source            | `"Deal 15 damage and restore 8 health"`     |
| Old translation       | `"Завдає 10 шкоди та відновлює 5 здоров'я"` |
| Extracted old numbers | `["10", "5"]`                               |
| Extracted new numbers | `["15", "8"]`                               |
| **Result**            | `"Завдає 15 шкоди та відновлює 8 здоров'я"` |

**Fallback:** if the number counts differ between old and new source,
transplantation is impossible. The original matched translation is returned
as a plain text_norm match (confidence 0.75) instead.

During auto-apply, numeric matches are assigned status **`fuzzy`** rather than `tm`,
because the translation was modified automatically.

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

The TM Suggestions tab shows up to **10** candidates for the current string.
Candidates come from a dedicated query that runs all five match methods
(exact, numeric, punct_norm, fuzzy, and phrase-segment) and deduplicates
results by translated text.

Results are sorted by a combined score: `method_weight × similarity`, then
by translation status priority.

| Column       | Description                                                  |
| ------------ | ------------------------------------------------------------ |
| Status badge | The status of the source translation (e.g. `reviewed`, `tm`) |
| Method label | `Exact`, `Punct`, `Phrase`, or `Fuzzy`                       |
| Translation  | The suggested translation text                               |
| Score        | Similarity score displayed as a percentage (0–100%)          |
| Apply button | Copies the suggestion text into the translation field        |

**Apply button behaviour:**

Clicking **Apply** copies the suggestion text directly into the translation
textarea in the Detail Panel. It does **not** save automatically — the field
status remains unchanged until you save with **Ctrl+S** or **Ctrl+Enter**.
At that point the status you have selected in the Detail Panel is saved
(default: `Draft` if no status was set).

**Phrase-segment method:** if the full string has no match but can be split
into sentence-delimited clauses (`.`, `!`, `?`, `;`, `:`, newline), each
clause is looked up independently. Matched clause translations are shown as
separate suggestions with similarity **50%** and the label `Phrase`.

---

## How Translations Enter the TM

Every time you save a translation (any status: Draft, Reviewed, Human, TM,
Fuzzy, or Auto), it is added to the TM automatically.

Imported translations — from EET files, CSV, or TMX — also populate the TM.

**Deduplication policy:**

The `translations` table holds **one translation per (source string, target language)
pair**. Saving a new translation for a string that already has one replaces
the old record entirely (DELETE + INSERT). There is no accumulation of multiple
translations for the same string — only the latest save is kept.

Because multiple strings can share the same `text_norm`, saving one string's
translation can automatically propagate to all other strings with the same
normalized source text that do not yet have a `draft`, `reviewed`, or `human`
translation. This propagation assigns status **`tm`** to the filled strings.

**TMX and CSV imports** use the same `upsertTranslation` path, so they
respect the same one-per-string rule and also trigger propagation.

---

## Sharing the TM: TMX Export/Import

You can export the full TM (or a per-mod subset) as a TMX 1.4b file
compatible with Trados, memoQ, OmegaT, and other CAT tools.

You can also import a TMX file produced by another tool to populate the TM.

See [TMX Exchange](10-tmx.md) for details.

---

← [Keyboard Shortcuts](04-keyboard-shortcuts.md) | [Home](README.md) | **Next: [LLM Translation →](06-llm-translation.md)**
