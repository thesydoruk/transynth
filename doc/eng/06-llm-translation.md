# 06 — LLM Translation

Use AI to automatically translate strings in bulk, with glossary injection and
placeholder protection.

---

## Table of Contents

- [Overview](#overview)
- [Supported Providers](#supported-providers)
  - [OpenAI](#openai)
  - [vLLM (local)](#vllm-local)
  - [Embedded vLLM and embed](#embedded-vllm-and-embed)
  - [Fallback Chain](#fallback-chain)
- [Configuring the Provider](#configuring-the-provider)
- [Running a Batch Translation](#running-a-batch-translation)
- [Verify, skip-detect, and gender](#verify-skip-detect-and-gender)
- [Placeholder Masking](#placeholder-masking)
- [Glossary Injection](#glossary-injection)
- [Style Guide](#style-guide)
- [Reviewing Auto-translated Strings](#reviewing-auto-translated-strings)
- [Limitations and Best Practices](#limitations-and-best-practices)

---

## Overview

The pipeline can send batches of source strings to a Large Language Model (LLM)
and receive translations back as a structured JSON array.

Dedicated system prompts (and EN→UK glossaries) are written for **Ukrainian**.
Any other target language uses the generic English prompt in `src/llm/prompts/en.ts`.
Do not treat the product as language-neutral until those prompts are generalized.

LLM translation is best used **after the TM waterfall** — it fills in strings
that have no TM match. Strings translated by LLM receive the status **Auto**.

---

## Supported Providers

### OpenAI

Uses the OpenAI Chat Completion API.
Requires an API key and incurs cost per token.

The model is set via `OPENAI_TRANSLATE_MODEL` (default: **`gpt-4.1-mini`**).
For maximum quality at higher cost, set it to `gpt-4o` or `gpt-4.1`.

Cost varies by model and mod size. Strings go in batches (`BATCH_SIZE`, default
30; the web UI also caps a request at 100 rows). A mod with 5 000 untranslated
strings of average 20 tokens each uses roughly
100 000 input tokens + 100 000 output tokens. At `gpt-4.1-mini` prices this is
typically a few US cents. Check [OpenAI pricing](https://openai.com/pricing) for
current rates. Strings already covered by TM do not incur LLM cost.

### vLLM (local)

[vLLM](https://docs.vllm.ai/) and other OpenAI-compatible inference servers (TGI, LiteLLM proxy, etc.)
run LLMs locally on your own machine or GPU server.

The vLLM provider connects to `VLLM_BASE_URL` (default: `http://localhost:8000`)
using the standard OpenAI-compatible `/v1` API. Any server that implements
`/v1/chat/completions` and `/v1/embeddings` works without extra adapters.

Example vLLM launch:

```bash
vllm serve meta-llama/Meta-Llama-3-8B-Instruct --port 8000
```

Set in `.env`:

```env
LLM_PROVIDER=vllm
VLLM_BASE_URL=http://localhost:8000
VLLM_MODEL=meta-llama/Meta-Llama-3-8B-Instruct
```

If your server requires authentication, set `VLLM_API_KEY`. For a separate
embedding server, set `VLLM_EMBED_BASE_URL` and `VLLM_EMBED_MODEL`.

Minimum hardware guidance:

| Model size  | GPU VRAM needed | Notes                              |
| ----------- | --------------- | ---------------------------------- |
| 7 B params  | 6–8 GB VRAM     | Fast on consumer GPUs              |
| 13 B params | 10–12 GB VRAM   | Better translation quality         |
| 70 B params | 40+ GB VRAM     | Near GPT-4 quality; needs big GPUs |

CPU inference is possible but much slower than GPU. For large mods, GPU is
strongly recommended.

### Embedded vLLM and embed

The repo ships two Compose overlays — the same opt-in style as `embedded-db`.
Profiles are independent: chat only, RAG only, or both.

| Profile          | File                       | Service      | On the host                | From `web` / `worker`    |
| ---------------- | -------------------------- | ------------ | -------------------------- | ------------------------ |
| `embedded-vllm`  | `docker/compose.vllm.yml`  | `vllm-gemma` | `http://localhost:8011/v1` | `http://vllm-gemma:8000` |
| `embedded-embed` | `docker/compose.embed.yml` | `tei-embed`  | `http://localhost:8013`    | `http://tei-embed:80`    |

Chat is Gemma 4 26B A4B IT (AWQ), served as `gemma4:26b-a4b`. Embeddings are
Snowflake `arctic-embed-l-v2.0` via Text Embeddings Inference. You need the
**NVIDIA Container Toolkit**. The first start downloads tens of GB into
`data/huggingface` and `data/vllm-gemma-4-26b-a4b`. Set `HF_TOKEN` if the
Hugging Face weights are gated.

In `.env` (next to `COMPOSE_PROFILES=embedded-db,embedded-vllm,embedded-embed`):

```env
LLM_PROVIDER=vllm
VLLM_BASE_URL=http://localhost:8011
VLLM_MODEL=gemma4:26b-a4b
VLLM_EMBED_BASE_URL=http://localhost:8013
VLLM_EMBED_MODEL=Snowflake/snowflake-arctic-embed-l-v2.0
DOCKER_VLLM_BASE_URL=http://vllm-gemma:8000
DOCKER_VLLM_EMBED_BASE_URL=http://tei-embed:80
```

`VLLM_*` is for host processes (`npm run dev`, `curl`). `DOCKER_VLLM_*` is
what Compose injects into `web` / `worker` instead of localhost (same idea as
`DOCKER_DATABASE_URL`). Without `DOCKER_*`, the containers look for the model
on `host.docker.internal:8000`.

```bash
docker compose up -d
```

vLLM’s first healthcheck can take up to five minutes; TEI can take longer.
Check:

```bash
curl -s http://localhost:8011/v1/models
curl -s http://localhost:8013/health
```

Restart one overlay:

```bash
docker compose --profile embedded-vllm restart vllm-gemma
docker compose --profile embedded-embed restart tei-embed
```

**Settings → LLM.** An empty server pool falls back to `.env`. If you already
saved hosts (`localhost:8000`, …), the overlay is ignored — clear the list, or
set `http://vllm-gemma:8000` (UI in Compose) / `http://localhost:8011` (API on
the host).

One GPU for both services: lower `VLLM_GPU_MEMORY_UTILIZATION` (e.g. `0.82`).
Two cards: `LLM_GPU_DEVICE=0` and `EMBED_GPU_DEVICE=1`. Blackwell:
`VLLM_OPENAI_IMAGE=vllm/vllm-openai:gemma4-0505-cu130`. TEI tag: Ampere
`86-1.8`, Ada `89-1.8` (`TEI_IMAGE`).

Production with an external pool leaves both profiles unset. First-run
commands: [Getting Started](01-getting-started.md).

### Fallback Chain

If the primary provider is **unavailable**, the pipeline automatically retries
with the fallback provider.

Set the fallback via the `LLM_FALLBACK` environment variable:

```
LLM_FALLBACK=openai # or vllm, or none (default)
```

Fallback is triggered only on **availability errors** — connection refused,
DNS failures, timeouts, connection resets, or HTTP 503. Rate-limit errors
(429) and authentication failures are **not** retried via the fallback;
those errors are thrown immediately.

On an **availability** error the same attempt tries the fallback provider
immediately. If that also fails, the loop retries up to `LLM_MAX_ATTEMPTS`
(default **5**) with exponential backoff (1 s, 2 s, 4 s, … plus jitter, cap
30 s).

---

## Configuring the Provider

All LLM settings are configured via `.env` variables:

| Variable                 | Default                  | Description                                                  |
| ------------------------ | ------------------------ | ------------------------------------------------------------ |
| `LLM_PROVIDER`           | `vllm`                   | Primary provider: `openai` or `vllm`                         |
| `LLM_FALLBACK`           | `none`                   | Fallback provider: `openai`, `vllm`, or `none`               |
| `OPENAI_API_KEY`         | _(empty)_                | Required when `LLM_PROVIDER=openai`                          |
| `OPENAI_TRANSLATE_MODEL` | `gpt-4.1-mini`           | OpenAI model for translation                                 |
| `OPENAI_EMBED_MODEL`     | `text-embedding-3-large` | OpenAI model for embeddings                                  |
| `VLLM_BASE_URL`          | `http://localhost:8000`  | vLLM / OpenAI-compatible server address                      |
| `VLLM_API_KEY`           | _(empty)_                | Optional API key when the server requires auth               |
| `VLLM_MODEL`             | _(empty)_                | Required when `LLM_PROVIDER=vllm`                            |
| `VLLM_EMBED_MODEL`       | _(empty)_                | Optional separate embedding model (defaults to `VLLM_MODEL`) |
| `BATCH_SIZE`             | `30`                     | Strings per LLM HTTP batch (web jobs and CLI)                |

See [Configuration](14-configuration.md) for the full reference.

---

## Running a Batch Translation

Whole-mod TM or LLM translate uses the circular **Translate** control (editor
toolbar and Mods list). For a subset of rows:

1. **Filter** the strings — for example Status `untranslated` and GRUP `DIAL`.
2. **Select** them: checkboxes, `Space` on the focused row, or `Ctrl+A` /
   the header checkbox for **every row matching the filter** (not one page).
3. The toolbar shows **Auto-Translate N selected**. The context menu has the
   same LLM action plus Apply TM. There are no Approve / Reject batch buttons.
4. Progress shows as **Translating X/Y**. Each request sends at most **100**
   strings; a larger “select all matching” run is split automatically.
5. Finished rows get status **Auto**. The grid refreshes as batches complete.

The web UI does not attach a style guide to batch translation.
For style-guided translation, use the CLI (`npm run translate`).

On the Dialogs tab, **Fill LLM** / **Fill TM** in the transcript header run the
same endpoints for the visible group.

---

## Verify, skip-detect, and gender

These are separate jobs on the same circular control strip.

- **Verify** opens a modal (`llm-verify`). Options: auto-approve strings the
  model marks clean, auto-apply suggested fixes for suspicious lines, and
  whether to include already confirmed translations. Results stay in the modal
  until you close it.
- **Skip-detect** marks rows that should not be translated. Heuristic is cheap
  (same-as-source, empty, codes). **With LLM** asks the model as well. Status
  becomes `skip`.
- **Gender-detect** (Bethesda only) fills speaker / addressee gender used by
  QA `gender_mismatch` and by Ukrainian prompts. Disco hides this control.

Skipped rows stay out of later TM/LLM passes until you unskip them.

---

## Placeholder Masking

Game strings contain special tokens that must not be translated:

- `<Alias=Player>`, `<Alias=CompanionTarget>` — dynamic name substitutions
- `[DIAL:001234AB]` — form reference links
- `\n` — newline characters

The pipeline **masks** these tokens before sending to the LLM (replacing them
with numbered markers `¤PH0¤`, `¤PH1¤`, …) and **unmasks** them in the response.

For script-like strings, the pipeline also masks legacy `FunctionKeywords`
tokens with markers like `¤FK0¤` so Papyrus function names and declaration
keywords survive translation unchanged.

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
Original: "<Alias=Player> received {0} caps from <Alias=NPC>."
Masked: "¤PH0¤ received ¤PH1¤ caps from ¤PH2¤."
→ LLM → "¤PH0¤ отримав ¤PH1¤ кришок від ¤PH2¤."
Restored: "<Alias=Player> отримав {0} кришок від <Alias=NPC>."
```

The LLM is instructed in the system prompt to **keep `¤PH0¤` and `¤FK0¤` tokens unchanged**.
After receiving the response, the pipeline restores each token positionally.

The web UI batch translate now applies the same protected-token masking before
calling the LLM. Glossary injection still runs through the system prompt.

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
request (first 4 000 characters). The web UI batch translate does not
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
3. Set status to **Reviewed** when satisfied (context menu / status control).
   **Human** is for imported or confirmed translations, not a separate Approve
   button.

For large batches, filter the editor by **Status = Auto** or use the **Drafts only**
toolbar filter to work through results in the mod editor.

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
- **Local model quality:** smaller local models (7–8 B) produce significantly lower quality than
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
