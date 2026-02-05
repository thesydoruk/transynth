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
- [Best Practices](#best-practices)

---

## What is the Glossary?

The glossary is a list of term pairs: a **source term** (usually English) and
its preferred **target translation**.

Example:

| Source term | Translation |
|-------------|-------------|
| Synth | Синт |
| Brotherhood of Steel | Братство Сталі |
| Vault | Сховище |
| Pip-Boy | Пін-Бой |

Using the glossary ensures that every translator and every LLM call uses the
same terminology — vital for a cohesive, professional translation.

---

## Opening the Glossary Page

Navigate to **Glossary** in the top navigation bar (route: `/glossary`).

> TODO: Screenshot placeholder.

---

## Adding Terms

> TODO: Describe the "Add Term" form:
> - Source language dropdown (default: EN)
> - Target language dropdown (default: UK)
> - Source term field
> - Translation field (optional — you can add the source term now and fill
>   the translation later)
> - Click "Add" or press Enter

---

## Editing and Removing Terms

> TODO: Describe how to edit an existing term (click pencil icon or inline edit).
> Describe the removal flow (click trash icon → confirmation).
> Note that removing a term does not affect already-saved translations.

---

## Searching the Glossary

Use the search bar at the top of the glossary list to filter terms by
source text, translation, or both.

> TODO: Describe the search behaviour (real-time filter vs. server-side search).

---

## Language Pairs

The glossary supports multiple language pairs.
Use the language dropdowns to switch between pairs (e.g. EN→UK, EN→RU).

> TODO: Explain how language pairs work.
> Note that a term added for EN→UK is separate from EN→RU.

---

## LLM Injection

When a batch LLM translation is triggered, the pipeline:

1. Fetches up to **100 top glossary terms** for the relevant language pair.
2. Formats them as a reference list in the LLM system prompt.
3. The LLM is instructed to respect glossary entries when translating.

> TODO: Explain what "top 100 terms" means — is there prioritisation?
> Add example of what a generated system prompt looks like with glossary terms.
> Note that the LLM may still deviate — always review **Auto** strings for
> glossary compliance.
> Mention that QA terminology enforcement (planned feature) will flag violations.

---

## Best Practices

> TODO:
> - Add terms before running LLM translation for the first time.
> - Prioritise proper nouns: faction names, item names, locations, character names.
> - Use the same capitalisation as it appears in game.
> - For terms with multiple valid translations (e.g. regional dialect variations),
>   pick one and stick with it.
> - Review LLM output for glossary compliance and correct manually if needed.
> - Export the glossary periodically as a CSV/TMX backup.

---

← [Quality Assurance](07-qa.md) | [Home](README.md) | **Next: [Exporting →](09-export.md)**
