# 06 — LLM Translation

Use AI to automatically translate strings in bulk, with glossary injection and
placeholder protection.

---

## Table of Contents

- [Overview](#overview)
- [Supported Providers](#supported-providers)
  - [OpenAI](#openai)
  - [Ollama (local)](#ollama-local)
  - [Fallback Chain](#fallback-chain)
- [Configuring the Provider](#configuring-the-provider)
- [Running a Batch Translation](#running-a-batch-translation)
- [Placeholder Masking](#placeholder-masking)
- [Glossary Injection](#glossary-injection)
- [Style Guide](#style-guide)
- [Reviewing Auto-translated Strings](#reviewing-auto-translated-strings)
- [LLM Translation Cache](#llm-translation-cache)
- [Limitations and Best Practices](#limitations-and-best-practices)

---

## Overview

The pipeline can send batches of source strings to a Large Language Model (LLM)
and receive translations back as a structured JSON array.

LLM translation is best used **after the TM waterfall** — it fills in strings
that have no TM match. Strings translated by LLM receive the status **Auto**.

---

## Supported Providers

### OpenAI

Uses the OpenAI Chat Completion API.
Requires an API key and incurs cost per token.

The model is set via `OPENAI_TRANSLATE_MODEL` (default: **`gpt-4.1-mini`**).
For maximum quality at higher cost, set it to `gpt-4o` or `gpt-4.1`.

Cost varies by model and mod size. Each string is translated individually;
a mod with 5 000 untranslated strings of average 20 tokens each uses roughly
100 000 input tokens + 100 000 output tokens. At `gpt-4.1-mini` prices this is
typically a few US cents. Check [OpenAI pricing](https://openai.com/pricing) for
current rates. Strings already in the TM or LLM cache are free.

### Ollama (local)

[Ollama](https://ollama.com) runs LLMs locally on your own machine or server.
No API key or internet connection required. Free but requires hardware.

Recommended models: `llama3`, `mistral`, `gemma2`.

The Ollama provider connects to `OLLAMA_BASE_URL` (default: `http://localhost:11434`)
using the OpenAI-compatible `/v1` API endpoint, so any model that Ollama
supports works automatically.

Minimum hardware guidance:

| Model size  | GPU VRAM needed | Notes                                         |
| ----------- | --------------- | --------------------------------------------- |
| 7 B params  | 6–8 GB VRAM     | `llama3`, `mistral:7b`, `gemma2:9b`           |
| 13 B params | 10–12 GB VRAM   | Better translation quality                    |
| 70 B params | 40+ GB VRAM     | Near GPT-4 quality; slow on consumer hardware |

CPU inference is possible but roughly 10–50× slower than GPU.
For large mods, GPU is strongly recommended.

Browse available models at [ollama.com/library](https://ollama.com/library).

### Fallback Chain

If the primary provider is **unavailable**, the pipeline automatically retries
with the fallback provider.

Set the fallback via the `LLM_FALLBACK` environment variable:

```
LLM_FALLBACK=openai   # or ollama, or none (default)
```

Fallback is triggered only on **availability errors** — connection refused,
DNS failures, timeouts, connection resets, or HTTP 503. Rate-limit errors
(429) and authentication failures are **not** retried via the fallback;
those errors are thrown immediately.

The retry mechanism (separate from the fallback) attempts each provider
up to **3 times** with exponential backoff: 1 s, 2 s, 4 s (plus jitter,
capped at 30 s). Only after all retries fail does the fallback provider
activate.

---

## Configuring the Provider

All LLM settings are configured via `.env` variables:

| Variable                 | Default                  | Description                                         |
| ------------------------ | ------------------------ | --------------------------------------------------- |
| `LLM_PROVIDER`           | `ollama`                 | Primary provider: `openai` or `ollama`              |
| `LLM_FALLBACK`           | `none`                   | Fallback provider: `openai`, `ollama`, or `none`    |
| `OPENAI_API_KEY`         | _(empty)_                | Required when `LLM_PROVIDER=openai`                 |
| `OPENAI_TRANSLATE_MODEL` | `gpt-4.1-mini`           | OpenAI model for translation                        |
| `OPENAI_EMBED_MODEL`     | `text-embedding-3-large` | OpenAI model for embeddings                         |
| `OLLAMA_BASE_URL`        | `http://localhost:11434` | Ollama server address                               |
| `OLLAMA_MODEL`           | _(empty)_                | Required when `LLM_PROVIDER=ollama` (e.g. `llama3`) |
| `BATCH_SIZE`             | `30`                     | Number of strings per LLM batch (CLI only)          |

See [Configuration](17-configuration.md) for the full reference.

---

## Running a Batch Translation

1. **Filter** the strings you want to translate — for example, set Status to
   `untranslated` and GRUP to `DIAL` for untranslated dialogue.
2. **Select** the rows: `Space` toggles individual rows, `Ctrl+A` selects all
   rows on the current page, or use checkboxes.
3. When rows are selected, an **"Auto-Translate N selected"** button appears in
   the toolbar (next to the Approve and Reject batch buttons).
4. Click **Auto-Translate** (or right-click → **Auto-Translate** in the context
   menu). A progress badge **Translating X/Y** replaces the button while running.
5. The endpoint processes up to **100 strings** per batch. For larger selections,
   split into multiple runs.
6. Each string is translated individually with SSE progress streaming. Cache hits
   return instantly; uncached strings call the LLM.
7. After completion, the grid refreshes automatically. Translated strings appear
   with status **Auto**.

Note: the web UI does not support style guide during batch translation.
For style-guided translation, use the CLI (`npm run translate`).

---

## Placeholder Masking

Game strings contain special tokens that must not be translated:

- `<Alias=Player>`, `<Alias=CompanionTarget>` — dynamic name substitutions
- `[DIAL:001234AB]` — form reference links
- `\n` — newline characters

The pipeline **masks** these tokens before sending to the LLM (replacing them
with numbered markers `¤PH0¤`, `¤PH1¤`, …) and **unmasks** them in the response.

This prevents the LLM from corrupting or translating placeholders.

Token types that are masked:

| Pattern                    | Example                                        |
| -------------------------- | ---------------------------------------------- |
| Printf specifiers          | `%s`, `%d`, `%1$s`                             |
| Numeric placeholders       | `{0}`, `{1}`                                   |
| Named placeholders         | `{item}`, `{PlayerName}`                       |
| Square-bracket refs        | `[DIAL:001234AB]`                              |
| Angle-bracket tags/aliases | `<Alias=Player>`, `<b>`, `<font color='#fff'>` |
| Dollar-sign variables      | `$PlayerName`, `$CompanionTarget`              |

**Before/after example:**

```
Original:   "<Alias=Player> received {0} caps from <Alias=NPC>."
Masked:     "¤PH0¤ received ¤PH1¤ caps from ¤PH2¤."
→ LLM →    "¤PH0¤ отримав ¤PH1¤ кришок від ¤PH2¤."
Restored:   "<Alias=Player> отримав {0} кришок від <Alias=NPC>."
```

The LLM is instructed in the system prompt to **keep `¤PH0¤` tokens unchanged**.
After receiving the response, the pipeline restores each token positionally.

Note: placeholder masking is applied in the CLI translator (`translateMod.ts`).
The web UI batch translate sends raw text; glossary terms protect named
concepts through glossary masking (`¤GL0¤`) instead.

---

## Glossary Injection

The pipeline injects **up to 80 glossary terms** (web UI) or **up to 100 terms**
(CLI) into the system prompt, giving the model a reference for preferred
translations of key game terminology.

Example injected into system prompt:

```
brotherhood of steel → Братство Сталі
synth → синт
```

See [Glossary](08-glossary.md) for how to manage your terms.

---

## Style Guide

You can provide a Markdown-formatted style guide that the LLM follows when
translating — specifying tone, formality, dialect, and terminology preferences.

The style guide is available in the **CLI translator only** (`translateMod.ts`).
Pass it with the `--style` flag pointing to a Markdown file:

```bash
npm run translate -- --in export.csv --out translated.csv --style style.md
```

The style guide content is injected into the `style_guide` field of the LLM
request (first 4 000 characters). The web UI batch translate does not currently
support a style guide — it uses only the glossary injection.

**Example style guide for Fallout 4 Ukrainian:**

```markdown
# Translation Style Guide — Fallout 4 Ukrainian

## Tone

- Post-apocalyptic setting: gritty, worn, pragmatic tone.
- NPCs range from gruff soldiers to cheerful vault dwellers — match the character voice.
- Avoid modern internet slang or anachronistic phrasing.

## Formality

- Use informal "ти" for companions and generic NPCs.
- Use formal "ви" for faction leaders and formal quest givers.

## Dialect

- Standard modern Ukrainian orthography.
- Avoid Russianisms (кальки з російської).
- Prefer native Ukrainian words over loanwords where natural.

## Terminology

- Measurements: keep as-is (caps, rads, lbs) — do not convert.
- Faction names: translate as defined in the glossary.
- "Brotherhood of Steel" → "Братство Сталі" (always).
```

---

## Reviewing Auto-translated Strings

All LLM-translated strings receive the status **Auto**.
Before publishing your translation, review these strings in the editor:

1. Filter by **Status = Auto**.
2. Check each translation for errors, placeholder integrity, and game tone.
3. Set status to **Approved** when satisfied.

For large batches, use the [Review Queue](15-review-queue.md) to prioritise
low-confidence translations first.

---

## LLM Translation Cache

Identical source strings are cached at the database level.
If the same string appears in multiple mods, it is translated only once.

The cache is stored in the `translation_cache` table with the following key:
`(text_norm, src_lang, tgt_lang, model)`.

The **cache key uses normalised text** (`text_norm`): whitespace is collapsed,
case is lowercased, placeholders become `¤PH¤`, and numbers become `¤NUM¤`.
This means strings that differ only in number values or whitespace can still
hit the same cache entry.

When a string is found in the cache, the stored translation is returned
instantly without calling the LLM. If the same text is translated again
with new content (and you want a fresh result), clear the relevant cache
row manually:

```sql
-- Clear cache for a specific string
DELETE FROM translation_cache
WHERE text_norm = translation_cache.text_norm  -- replace with the normalised text
  AND src_lang = 'en' AND tgt_lang = 'uk' AND model = 'gpt-4.1-mini';

-- Clear entire LLM cache (forces re-translation of everything)
TRUNCATE translation_cache;
```

There is no UI for cache management — use direct database access.

---

## Limitations and Best Practices

**Known limitations:**

- **Context window:** very long strings (books, terminal notes) can exceed the
  model context. If the API returns a truncated or empty translation, split the
  string or switch to a model with a larger context window.
- **Placeholder hallucination:** LLMs occasionally reorder, duplicate, or drop
  `¤PH0¤` tokens despite instructions. Always run the QA check after a batch
  to catch mismatched placeholders.
- **Proper nouns:** without glossary entries, LLMs will guess faction names,
  character names, and item names inconsistently.
- **Ollama quality:** local 7 B models produce significantly lower quality than
  GPT-4.1-mini, especially for complex dialogue. Plan for more manual review.
- **Rate limits:** OpenAI may return HTTP 429 on large batches. The retry
  mechanism handles transient bursts but sustained rate limits will stall
  translation. Reduce `BATCH_SIZE` or add delays if needed.
- **No streaming in CLI:** the CLI translator (`translateMod.ts`) sends strings
  in configurable batches (default 30) and blocks until each batch completes.

**Best practices:**

1. **Run TM first.** Apply the Translation Memory waterfall before LLM — it
   fills exact and near-exact matches for free and produces higher-quality
   results than the LLM for identical strings.
2. **Build the glossary before translating.** Add key faction names, item names,
   and recurring terminology to the Glossary page before the first LLM run.
3. **Use a style guide (CLI).** For large projects, write a style guide Markdown
   file and pass it with `--style` to enforce consistent tone and dialect.
4. **Filter by untranslated.** Always select only `untranslated` strings for
   LLM translation — do not overwrite existing TM, fuzzy, or human translations.
5. **Run QA after each batch.** Check for placeholder errors, missing
   translations, and length anomalies before exporting.
6. **Review Auto strings before publishing.** Filter by `Status = auto` in the
   editor and spot-check at minimum the high-visibility strings (quest names,
   NPC dialogue, UI labels).

---

← [Translation Memory](05-translation-memory.md) | [Home](README.md) | **Next: [Quality Assurance →](07-qa.md)**
