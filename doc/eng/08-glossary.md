# 08 — Glossary

The glossary stores your preferred translations for key terms and injects them
into LLM prompts to ensure consistent terminology across all mods.

---

## Table of Contents

- [What is the Glossary?](#what-is-the-glossary)
- [Opening the Glossary Page](#opening-the-glossary-page)
- [Adding Terms](#adding-terms)
- [Editing and Removing Terms](#editing-and-removing-terms)
- [Searching the Glossary](#searching-the-glossary)
- [Language Pairs](#language-pairs)
- [LLM Injection](#llm-injection)
- [Batch Enforcement](#batch-enforcement)
- [Best Practices](#best-practices)

---

## What is the Glossary?

The glossary is a list of term pairs: a **source term** (usually English) and
its preferred **target translation**.

Example:

| Source term          | Translation    |
| -------------------- | -------------- |
| Synth                | Синт           |
| Brotherhood of Steel | Братство Сталі |
| Vault                | Сховище        |
| Pip-Boy              | Пін-Бой        |

Using the glossary ensures that every translator and every LLM call uses the
same terminology — vital for a cohesive, professional translation.

---

## Opening the Glossary Page

Navigate to **Glossary** in the top navigation bar (route: `/glossary`).

The page opens showing terms for the selected language pair
(default: EN → UK).

---

## Adding Terms

The add form is at the top of the page, below the language filter controls.

1. Select the desired **source language** and **target language** in the
   dropdowns above the table (these set the language pair for the new term).
2. Type the **source term** in the left input field.
3. Optionally type the **translation** in the right input field.
   You can leave the translation empty and fill it in later — empty translations
   are stored and shown as `—` in the table.
4. Click **Add Pair** or press **Enter** (from the translation field) to save.

The source term field must not be empty; the Add button is disabled otherwise.
Adding a duplicate `(term, src_lang, tgt_lang)` triple returns an error —
the unique constraint on the database prevents it.

---

## Editing and Removing Terms

Existing terms can be edited inline in the glossary table.

To edit a term pair:

1. Click **Edit** in the row.
2. Update the source term and/or translation fields.
3. Click **Save** (or **Cancel** to discard changes).

To **remove** a term, click **✕** on its row. The deletion is immediate with
no confirmation prompt. Removing a term does not affect any already-saved
translations — it only stops injecting that term into future LLM prompts
and stops generating glossary-violation QA warnings for it.

---

## Searching the Glossary

Use the search bar at the top of the glossary list to filter terms by
source text, translation, or both.

Search is **server-side**: the page re-fetches from the API on every
keystroke (debounced by React Query). The query is passed as the `q`
parameter and performs a case-insensitive substring match against both the
`term` column and the `translation` column in the database.

---

## Language Pairs

The glossary supports multiple language pairs.
Use the **Source lang** and **Target lang** dropdowns to switch between pairs.

The dropdowns control both the **filter** (what rows are shown) and the
**add form** (what language pair a new term is created for).

Available options: `EN`, `UK`, and `All` (shows all pairs).

A term added for EN→UK is stored separately from EN→RU — the unique
constraint is `(term, src_lang, tgt_lang)`. You must create separate entries
for each target language you support.

The LLM translation route uses whatever pair matches the request's `srcLang`
and `targetLang` parameters (default `en`→`uk`).

---

## LLM Injection

When a batch LLM translation is triggered, the pipeline:

1. Fetches up to **80 glossary terms** (web UI route) for the relevant
   language pair, ordered alphabetically.
2. Inserts them as a reference block in the LLM system prompt:

```
You are a professional Fallout 4 game localizer. Translate from en to uk.
Output only the translated text, nothing else.

Key terminology to preserve:
- Brotherhood of Steel → Братство Сталі
- Institute → Інститут
- synth → синт
- Vault → Сховище
```

3. The LLM is instructed to preserve glossary entries when translating.

Terms are sorted alphabetically (no priority ranking). All active terms for
the selected language pair are included up to the 80-term limit — if you
have more than 80 terms, the first 80 alphabetically are used.

Terms that have no translation (empty `translation` column) are **not**
included in the hint — only pairs with a defined translation are injected.

The LLM may still deviate from glossary entries, especially for short or
ambiguous terms. Always review **Auto** strings for glossary compliance.
The QA engine generates a `glossary_violation` warning for any translation
where the expected target term is absent from the translation text.

---

## Batch Enforcement

Normally, glossary violations are detected **on save** — each time a
translation is saved or updated, `refreshQAIssues` checks it against the
current glossary. But what if you add new glossary terms **after**
translations have already been saved?

The **Enforce Glossary** panel at the bottom of the Glossary page lets you
re-scan all existing translations in bulk.

### How to run batch enforcement

1. Navigate to **Glossary** in the top nav.
2. In the **Enforce glossary** panel (below the add-term form), optionally
   select a specific mod from the dropdown — or leave it at **All mods**.
3. Click **Run Enforcement**.
4. The engine deletes all previous `glossary_violation` QA issues in scope,
   then checks every translated string against the current glossary.
5. A summary appears: _"Checked N strings — M violation(s) found."_

### Details

- **Word-boundary matching** — the source-side check uses `\b` anchors,
  so a glossary term "iron" will **not** match inside "environment" or
  "ironed". This prevents false positives.
- **Case-insensitive** — both source and target comparisons ignore case.
- The target-side check uses a plain substring match (no word boundaries)
  because Cyrillic words are often inflected.
- The operation runs inside a single database transaction, so either all
  changes commit or none do.
- After enforcement, navigate to any mod editor and check the **QA** tab
  to review newly created `glossary_violation` warnings.

### API endpoint

```
POST /api/glossary/enforce
Body (JSON, all optional):
  { "modId": 42, "targetLang": "uk" }
Response:
  { "checked": 1234, "violations": 17 }
```

---

## Best Practices

- **Add terms before running LLM translation.** The glossary is injected into
  every LLM call, so terms added after a translation run will only benefit
  future retranslations.
- **Prioritise proper nouns:** faction names (`Brotherhood of Steel`, `Institute`),
  item/weapon names, location names, companion names, and game-specific
  concepts (`Pip-Boy`, `Vault`, `synth`).
- **Match in-game capitalisation.** The injection and the QA check are both
  case-insensitive for detection, but the stored translation is used as-is
  in the system prompt, so consistent capitalisation looks more professional.
- **One canonical translation per term.** For terms with regional or stylistic
  variants, pick one and add only that. Conflicting entries for the same term
  confuse the model.
- **Review LLM output for glossary compliance.** After a translation run,
  filter by status `auto` and look for `glossary_violation` QA warnings.
- **Export regularly as a backup.** The glossary is stored in the database
  only; export a CSV of the glossary table if you want an external backup.

---

← [Quality Assurance](07-qa.md) | [Home](README.md) | **Next: [Exporting →](09-export.md)**
