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

Recommended model: `gpt-4o-mini` (good quality, low cost).
High-quality alternative: `gpt-4o`.

> TODO: Explain cost estimates for a typical mod (e.g. per 1 000 strings).

### Ollama (local)

[Ollama](https://ollama.com) runs LLMs locally on your own machine or server.
No API key or internet connection required. Free but requires hardware.

Recommended models: `llama3`, `mistral`, `gemma2`.

> TODO: Explain minimum hardware requirements (VRAM for GPU inference).
> Link to Ollama model library.

### Fallback Chain

If the primary provider fails (network error, quota exceeded), the pipeline
automatically retries with the fallback provider.

> TODO: Describe how the fallback chain is configured (`LLM_FALLBACK_PROVIDER`).

---

## Configuring the Provider

> TODO: List and explain the relevant `.env` variables:
> - `LLM_PROVIDER` — `openai` or `ollama`
> - `OPENAI_API_KEY`
> - `OPENAI_MODEL`
> - `OLLAMA_BASE_URL`
> - `OLLAMA_MODEL`
> - `LLM_FALLBACK_PROVIDER`
> Link to [Configuration](17-configuration.md) for the full reference.

---

## Running a Batch Translation

> TODO: Describe how to trigger LLM translation from the editor:
> 1. Filter the strings you want to translate (e.g. status = Empty, GRUP = DIAL).
> 2. Select all rows (or a subset).
> 3. Click "LLM Translate" (or use `Ctrl+Shift+X`).
> 4. A progress indicator shows the batch running.
> 5. Translated strings appear with status **Auto**.
> Screenshot placeholder.

---

## Placeholder Masking

Game strings contain special tokens that must not be translated:
- `<Alias=Player>`, `<Alias=CompanionTarget>` — dynamic name substitutions
- `[DIAL:001234AB]` — form reference links
- `\n` — newline characters

The pipeline **masks** these tokens before sending to the LLM (replacing them
with neutral markers like `¤PH0¤`), and **unmasks** them in the response.

This prevents the LLM from corrupting or translating placeholders.

> TODO: Show a before/after example.
> Note that the LLM is instructed to keep masked tokens unchanged.

---

## Glossary Injection

The pipeline injects up to 100 glossary terms into each LLM prompt, giving
the model a reference for preferred translations of key game terminology.

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

> TODO: Describe where to set the style guide in the UI.
> Provide an example style guide (Fallout 4 game tone, Ukrainian dialect notes).

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

> TODO: Describe the cache table and how to clear it if needed.

---

## Limitations and Best Practices

> TODO: List known limitations:
> - Long strings may exceed context window — split or use GPT-4 Turbo.
> - Game jargon and proper nouns need glossary entries to be consistent.
> - LLMs can hallucinate placeholder tokens — always check **Auto** strings.
> - Local Ollama models are slower and less accurate than GPT-4o.
>
> List best practices:
> - Run TM waterfall first, translate only Empty strings with LLM.
> - Use a style guide for consistent tone.
> - Build your glossary before running LLM translation.
> - After LLM run, use QA check to catch broken placeholders.

---

← [Translation Memory](05-translation-memory.md) | [Home](README.md) | **Next: [Quality Assurance →](07-qa.md)**
