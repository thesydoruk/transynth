# 08 — Glossary

The glossary stores your preferred translations for key terms and injects them
into LLM prompts to ensure consistent terminology across all mods.

---

## Table of Contents

- [What is the Glossary?](#what-is-the-glossary)
- [Built-in Fallout 4 Glossary (Seed)](#built-in-fallout-4-glossary-seed)
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

| Source term          | Translation      |
| -------------------- | ---------------- |
| Synth                | Синт             |
| Brotherhood of Steel | Братерство сталі |
| Vault                | Сховище          |
| Pip-Boy              | Піп-бой          |

Using the glossary ensures that every translator and every LLM call uses the
same terminology — vital for a cohesive, professional translation.

---

## Built-in Fallout 4 Glossary (Seed)

The project ships with a **ready-made glossary** of canonical Fallout 4
terminology (`EN → UK`): factions, locations, companions, creatures, robots,
chems, weapons/armor, and S.P.E.C.I.A.L. attributes. The pairs were curated
from the confirmed base-game translations (`Fallout4.esm`) by frequency.

- **Source of truth:** `src/resources/glossary/fo4-uk.ts` — a curated, typed
  list of pairs kept in git, so the terminology does not live in the database
  alone and can never be lost.
- **Seeding the database:** run

  ```bash
  npm run db:seed:glossary
  ```

  The script is **idempotent** — re-running only refreshes the seeded rows
  (`source = 'seed:fo4-base'`) and **never overwrites** terms added manually
  through the UI (`source = 'manual'`).

To extend the built-in glossary, add pairs to `fo4-uk.ts` and re-run the seed
command (recommended for terms that should live in the repo), or add one-off
terms through the **Glossary** page in the UI.

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

When a batch LLM translation is triggered, for each chunk of strings the
pipeline:

1. Loads the **entire** glossary for the relevant language pair.
2. Selects only the **relevant** terms — those whose source term actually
   occurs in the chunk's source strings (word-boundary `\b` match). This means
   a large glossary (hundreds of terms) is **not** truncated alphabetically;
   the prompt receives exactly what the current strings need.
3. Passes the selected pairs in the `glossary` field of the JSON request to the
   model (capped at 100 relevant terms per chunk to bound context size).

Example request payload (excerpt):

```json
{
  "target_language": "uk",
  "glossary": [
    { "term": "Brotherhood of Steel", "translation": "Братерство сталі" },
    { "term": "Power Armor", "translation": "Силова броня" }
  ],
  "items": [
    /* … strings to translate … */
  ]
}
```

The system prompt tells the model that the `glossary` field is **authoritative**
and takes priority over default conventions. Terms with an empty `translation`
column are **not** included — only pairs with a defined translation are injected.

> **Developer note.** Previously the first 80 terms _alphabetically_ were sent
> with every batch regardless of relevance, so relevant terms past the cutoff
> could be dropped. Injection is now filtered by chunk content (see
> `relevantGlossary` in `src/web/llmTranslateBatch.ts`).

Beyond the glossary, key canonical conventions (e.g. `...Rifle/Gun → ...карабін`,
`caps → кришки`, `Vault → Сховище`) are baked directly into the Ukrainian system
prompt as a fallback for terms not present in the glossary.

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
- **Keep shared terms in git.** Terms that should be shared across the team and
  survive a database reset belong in `src/resources/glossary/fo4-uk.ts`; apply
  them with `npm run db:seed:glossary`. Use the UI for one-off / local terms.

---

← [Quality Assurance](07-qa.md) | [Home](README.md) | **Next: [Exporting →](09-export.md)**
