# 14 — Configuration

All configurable settings are controlled via environment variables in the `.env` file.
A subset of active settings can also be viewed at runtime in the **Settings page** in the web UI.

---

## Table of Contents

- [Settings Page (Web UI)](#settings-page-web-ui)
- [The .env File](#the-env-file)
- [Database Settings](#database-settings)
- [LLM Provider Settings](#llm-provider-settings)
- [Server Settings](#server-settings)
- [Feature Flags](#feature-flags)
- [Docker Configuration](#docker-configuration)
- [Production Deployment Tips](#production-deployment-tips)

---

## Settings Page (Web UI)

The **Settings** page (`/settings`) provides a centralised view of all project configuration.
Open it from the gear icon on the right of the top bar.

Tabs: **General**, **LLM**, **Voice**, **Workflow**, **QA Rules**, **Activity**.
Glossary is on the game hub, not a Settings tab.

### General tab

Settings in the **General** tab are stored in your browser’s `localStorage`.
They have no server-side effect but pre-fill language selectors across all pages
(Mods, Editor, Coherence …).

| Setting                 | localStorage key     | Default |
| ----------------------- | -------------------- | ------- |
| Default source language | `transynth-src-lang` | `en`    |
| Default target language | `transynth-tgt-lang` | `uk`    |
| UI language             | `ui-lang`            | `uk`    |
| Theme                   | `transynth-theme`    | `dark`  |

### LLM tab

The **vLLM server pool** (hosts, parallelism, optional API keys) is editable
here and stored in `project_settings`. Provider choice and model names still
come from `.env` and are shown as read-only. The OpenAI API key is never sent
to the browser; only whether it is configured is shown.

### Voice tab

TTS server URL is `TTS_BASE_URL` in `.env` (read-only here). Parallelism,
line-reference mode, and per-game timing match are stored in `project_settings`.
See [Voice](09-voice.md).

### Workflow tab

Persisted in `project_settings`: auto-approve on save, propagate identical
strings, hide ignored by default, QA end-punctuation / min word count,
`import.skip_tes4`, RAG example count and minimum similarity, pipeline wait
and health-check intervals. The tab also has the RAG index rebuild action.

### QA Rules tab

Embedded editor for `qa_rules`. There is no `/qa-rules` route.

### Activity tab

Operator activity log (imports, jobs, handoffs). Filters and CSV export live
here. Diff’s **Open full activity log** deep-links to this tab. There is no
`/activity` route.

**System log** is a separate top-bar page (`/system-log`): LLM, TTS, job, and
system lines. It is not a Settings tab.

---

## The .env File

Copy `.env.example` to `.env` in the project root and fill in the required values:

```bash
cp .env.example .env
```

The `.env` file is never committed to version control.
All settings have defaults where possible; only required settings must be provided.

```env
# --- LLM Provider ---
# vllm (default) | openai
LLM_PROVIDER=vllm

# Fallback provider if primary is unavailable (none | vllm | openai)
LLM_FALLBACK=none

# --- vLLM / OpenAI-compatible local inference ---
VLLM_BASE_URL=http://localhost:8000
VLLM_MODEL=meta-llama/Meta-Llama-3-8B-Instruct
# VLLM_API_KEY=
# Optional: multiple identical vLLM servers (JSON array). Per-server limits override LLM_MAX_PARALLEL.
# VLLM_SERVERS=[{"host":"http://localhost:8000","maxParallel":4,"apiKey":""},{"host":"http://localhost:8001","maxParallel":2,"apiKey":"secret"}]
# VLLM_EMBED_MODEL=

# --- OpenAI (only if LLM_PROVIDER=openai) ---
# OPENAI_API_KEY=sk-...
# OPENAI_TRANSLATE_MODEL=gpt-4.1-mini
# OPENAI_EMBED_MODEL=text-embedding-3-large

# --- Database ---
DATABASE_URL=postgresql://transynth:transynth@localhost:5433/transynth

# --- Translation ---
# Number of strings sent to LLM per batch
BATCH_SIZE=30

# --- Logging ---
# Log level: error | warn | info | debug | trace (default: info)
LOG_LEVEL=info

# --- Upload limits ---
# Optional multipart cap in megabytes. Unset = no practical application-level limit.
# UPLOAD_MAX_FILE_SIZE_MB=10240

# Directory for log files (default: ./logs/)
# LOG_DIR=./logs/

# --- Debug ---
# DEBUG=1
```

---

## Database Settings

| Variable       | Default                                                     | Description                  |
| -------------- | ----------------------------------------------------------- | ---------------------------- |
| `DATABASE_URL` | `postgresql://transynth:transynth@localhost:5433/transynth` | PostgreSQL connection string |

The connection string format is:

```
postgresql://USERNAME:PASSWORD@HOST:PORT/DBNAME
```

Example: `postgresql://transynth:transynth@localhost:5433/transynth`

When using **Docker Compose**, the `web` and `cli` services override `DATABASE_URL` to
`postgresql://transynth:transynth@db:5432/transynth` inside the container network.
Your host `.env` should keep the `localhost:5433` URL for local scripts such as `npm run db:init`.
You do not need to set it manually when running the full stack with `docker compose up`.

---

## LLM Provider Settings

| Variable                     | Default                                   | Description                                                           |
| ---------------------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| `LLM_PROVIDER`               | `vllm`                                    | Primary LLM provider: `openai` or `vllm`                              |
| `LLM_FALLBACK`               | `none`                                    | Fallback provider if primary fails: `none`, `openai`, or `vllm`       |
| `OPENAI_API_KEY`             | _(required for OpenAI)_                   | Your OpenAI API key                                                   |
| `OPENAI_TRANSLATE_MODEL`     | `gpt-4.1-mini`                            | OpenAI model used for translation                                     |
| `OPENAI_EMBED_MODEL`         | `text-embedding-3-large`                  | OpenAI model used for embeddings                                      |
| `VLLM_BASE_URL`              | `http://localhost:8000`                   | vLLM / OpenAI-compatible API endpoint (legacy single-server mode)     |
| `VLLM_SERVERS`               | _(optional)_                              | JSON array of chat servers: `[{host, maxParallel, apiKey}, …]`        |
| `VLLM_API_KEY`               | _(optional)_                              | API key when the inference server requires authentication             |
| `LLM_MAX_PARALLEL`           | `2`                                       | Max concurrent chat requests (single-server mode only)                |
| `VLLM_MODEL`                 | _(required for vLLM)_                     | Model name served by vLLM, e.g. `meta-llama/Meta-Llama-3-8B-Instruct` |
| `VLLM_EMBED_BASE_URL`        | _(same as chat)_                          | Separate embedding server; otherwise `VLLM_BASE_URL`                  |
| `VLLM_EMBED_MODEL`           | `Snowflake/snowflake-arctic-embed-l-v2.0` | Embedding model when `VLLM_EMBED_BASE_URL` is used                    |
| `DOCKER_VLLM_BASE_URL`       | _(unset)_                                 | Chat URL for Compose `web`/`worker` (`http://vllm-gemma:8000`)        |
| `DOCKER_VLLM_EMBED_BASE_URL` | _(unset)_                                 | Embed URL inside Compose (`http://tei-embed:80`)                      |

> Chat temperature, decay, max tokens, retries, and HTTP timeout are env-set:
> `LLM_TEMPERATURE` (default `0.3`), `LLM_TEMPERATURE_DECAY`, `LLM_MAX_TOKENS`,
> `LLM_MAX_ATTEMPTS` (default `5`), `LLM_REQUEST_TIMEOUT_SEC`.
>
> When `VLLM_SERVERS` is set, chat requests are load-balanced across the listed
> hosts. Each entry needs `host`, `maxParallel`, and `apiKey`. Total chat concurrency
> is the sum of per-server limits; `LLM_MAX_PARALLEL` is ignored in that mode.
> Embeddings still use `VLLM_EMBED_BASE_URL` or the first server host.

---

## Server Settings

| Variable                  | Default        | Description                                                                                                     |
| ------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| `PORT`                    | `3000`         | Backend HTTP server port                                                                                        |
| `HOST`                    | `127.0.0.1`    | Backend bind address. Docker Compose sets `0.0.0.0` inside the container. See [SECURITY.md](../../SECURITY.md). |
| `UPLOAD_MAX_FILE_SIZE_MB` | unset          | Optional multipart upload cap in megabytes; unset = no practical limit                                          |
| `WEB_PORT`                | same as `PORT` | Host publish port in Docker Compose                                                                             |

> `PORT` and `HOST` are read from `process.env` (not `CONFIG` in `src/config.ts`).
> Vite proxies `/api` using `PORT`; there is no `VITE_API_BASE`.

Also in `.env.example` (not repeated in the tables above): `NEXUS_API_KEY`
(Discover / Nexus download), `REDIS_URL` (job queue; Compose sets
`redis://redis:6379`), `TTS_BASE_URL` (Fish Speech), `DATA_DIR`,
`CHAMPOLLION_PATH` / `WINE_*` after `tools:install`. The full list is the
example file.

---

## Feature Flags

There are no feature flags in the current version.
All features are enabled by default and cannot be selectively disabled via environment variables.

---

## Docker Configuration

The project ships with `docker-compose.yml` (web, worker, redis),
`docker/compose.db.yml` (Postgres, profile `embedded-db`),
`docker/compose.vllm.yml` (Gemma chat, profile `embedded-vllm`), and
`docker/compose.embed.yml` (Arctic embed, profile `embedded-embed`).
Add the profiles to `COMPOSE_PROFILES` and set `DOCKER_VLLM_*`, or the
containers call `host.docker.internal:8000`. How to enable:
[Getting Started](01-getting-started.md#optional-embedded-gemma-and-rag),
[LLM Translation](06-llm-translation.md#embedded-vllm-and-embed).
See also [SECURITY.md](../../SECURITY.md).
Production with an external vLLM pool leaves the model profiles unset.

### Starting the Stack

```bash
docker compose up -d
```

### Running Database Init

```bash
docker compose run --rm web npm run db:init
```

### Resetting Database (Development Only)

Use this command to fully wipe the current database and recreate schema objects
from `sql/schema.sql`:

```bash
npm run db:reset -- --yes
```

What it does:

- `DROP SCHEMA public CASCADE`
- `CREATE SCHEMA public`
- re-runs schema initialization

Use this only for development databases.

### Stopping

```bash
docker compose down
```

### Data Persistence

Embedded Postgres data lives in `./data/postgres` on the host (see
`docker/compose.db.yml`). It survives `docker compose down`. Do not use
`docker compose down -v` unless you intend to wipe it.

**Backup the PostgreSQL data volume:**

```bash
docker compose exec db pg_dump -U transynth transynth > backup_$(date +%Y%m%d).sql
```

**Restore from a backup:**

```bash
cat backup_20250101.sql | docker compose exec -T db psql -U transynth transynth
```

**Access the database from the host machine:**

The Docker stack maps PostgreSQL to port **5433** on the host (see `docker/compose.db.yml`):

```yaml
services:
  db:
    ports:
      - '5433:5432'
```

Then connect with any PostgreSQL client (e.g. pgAdmin, DBeaver) to `localhost:5433`
using the credentials from your `DATABASE_URL`.

---

## Production Deployment Tips

The Compose `web` image already builds the React UI. There is no separate
Vite service in production.

1. **External Postgres (typical production):** omit `COMPOSE_PROFILES` and
   `DOCKER_DATABASE_URL`. Point `DATABASE_URL` at your server. Start only
   `web`, `worker`, and `redis`.
2. **Do not overwrite a live `.env`** with `.env.example`.
3. **Reverse proxy:** terminate TLS in front of `WEB_PORT`. See [SECURITY.md](../../SECURITY.md).
   This is a trusted-LAN app — do not put the raw port on the public internet.
4. **Backups:** `pg_dump` the external database (or `./data/postgres` if you
   use the embedded profile). Never `docker compose down -v` on a machine
   that holds translation data.
5. **Deploy** by `git pull` and rebuilding the `web` image. `web` and `worker`
   share that image — restart both.

---

← [Coherence Checker](13-coherence.md) | [Home](README.md) | [Technology Stack](15-technology-stack.md) →
