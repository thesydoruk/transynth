# 05 — Translation Memory

The Translation Memory (TM) lets you reuse translations from previous work
automatically, reducing repetitive effort and improving consistency.

---

## Table of Contents

- [What is the Translation Memory?](#what-is-the-translation-memory)
- [Auto-Apply Match Methods](#auto-apply-match-methods)
  - [1. Anchor Match](#1-anchor-match)
  - [2. EDID Match](#2-edid-match)
  - [3. Text-Norm Match](#3-text-norm-match)
- [Auto-Apply on Import](#auto-apply-on-import)
- [Manually Applying TM Suggestions](#manually-applying-tm-suggestions)
- [RAG Examples Tab in the Detail Panel](#rag-examples-tab-in-the-detail-panel)
- [How Translations Enter the TM](#how-translations-enter-the-tm)

---

## What is the Translation Memory?

A Translation Memory is a database of previously translated string pairs:
`(source text) → (translation)`.

When you import a new mod, the pipeline checks every source string against
the TM. If a match is found, the translation is auto-filled, saving you
from re-translating identical or near-identical text.

The TM grows over time as you translate more mods.

If the Glossary page is still empty, the UI adds role-aware guidance instead of only passive placeholder text. Translators are prompted to seed repeated project terms first, reviewers are nudged to add disputed terminology before review, and admins get a reminder to establish the shared terminology baseline before large imports or LLM runs.

---

## Auto-Apply Match Methods

Auto-apply reuses an existing translation only when the source text is an
**exact or anchor match**. Methods are attempted from most precise to least;
the first match wins.

> **Why only exact matches?** Approximate heuristics (trigram fuzzy,
> punctuation-stripped, numeric transplant, phrase segmentation, reverse TM)
> were retired from auto-apply. The LLM + RAG pipeline produces higher-quality
> results for non-identical strings, so TM auto-apply is now limited to free,
> instant, lossless reuse of identical text. For non-identical strings, see the
> [RAG Examples tab](#rag-examples-tab-in-the-detail-panel), which surfaces
> reference translations via the same retrieval that feeds the LLM.

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
(`reviewed` > `human` > `tm` > `auto` > `draft`).

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

Example: the strings `"Hello, World!"` and `"Hello, World!"` both normalise
to `"hello, world!"` and produce a match even though the original whitespace
differs.

Because numbers are replaced during normalisation, two strings whose only
difference is numeric values share the same `text_norm` and therefore match.
Auto-apply reuses the existing translation verbatim; it does **not** transplant
the changed numbers (that approximate behaviour now lives only in the
RAG Examples tab).

---

## Auto-Apply on Import

When you import a mod, the pipeline automatically runs the exact/anchor match
methods for every string and fills any matched translations.

Strings filled this way receive the status **TM**.
You can review and approve them in the editor.

---

## Manually Applying TM Suggestions

If a string has no auto-filled translation, you can still reuse a reference
translation from the Detail Panel:

1. Select the string in the grid.
2. Click the **RAG Examples** tab in the Detail Panel.
3. Click **Apply** next to an example to copy it into the translation field.
4. Edit if needed, then save with **Ctrl+S**.

You can also trigger re-matching for the entire mod (or a filtered set of strings)
using the batch **Apply TM** action.

---

## RAG Examples Tab in the Detail Panel

The **RAG Examples** tab shows up to **10** reference translations for the
current string. It is powered by the **same RAG hybrid retrieval that feeds the
LLM** (`findReferenceExamples`): TM-style matches (exact, numeric, punct_norm,
fuzzy) plus pgvector semantic similarity (`embedding`). There is no longer a
separate suggestion query — the panel and the LLM share one source of truth.

Only `reviewed` / `human` translations are eligible (the RAG index). Results
are ranked by a combined score (`method_weight × similarity`). If RAG is
unavailable (e.g. pgvector is not installed), the panel simply shows no
examples instead of erroring.

| Column       | Description                                                 |
| ------------ | ----------------------------------------------------------- |
| Match badge  | The match quality as a percentage (0–100%)                  |
| Method label | `exact`, `numeric`, `punct`, `semantic`, or `fuzzy`         |
| Translation  | The reference translation (hover to see its source text)    |
| Apply button | Copies the reference translation into the translation field |

**Apply button behaviour:**

Clicking **Apply** copies the reference translation directly into the
translation textarea. It does **not** save automatically — the field status
remains unchanged until you save with **Ctrl+S** or **Ctrl+Enter**. At that
point the status you have selected in the Detail Panel is saved
(default: `Draft` if no status was set).

---

## How Translations Enter the TM

Every time you save a translation (any status: Draft, Reviewed, Human, TM,
Fuzzy, or Auto), it is added to the TM automatically.

Imported translations — from EET files or CSV — also populate the TM.

**Deduplication policy:**

The `translations` table holds **one translation per (source string, target language)
pair**. Saving a new translation for a string that already has one replaces
the old record entirely (DELETE + INSERT). There is no accumulation of multiple
translations for the same string — only the latest save is kept.

Because multiple strings can share the same `text_norm`, saving one string's
translation can automatically propagate to all other strings with the same
normalized source text that do not yet have a `draft`, `reviewed`, or `human`
translation. This propagation assigns status **`tm`** to the filled strings.

**CSV imports** use the same `upsertTranslation` path, so they respect the
same one-per-string rule and also trigger propagation.

---

← [Keyboard Shortcuts](04-keyboard-shortcuts.md) | [Home](README.md) | **Next: [LLM Translation →](06-llm-translation.md)**
