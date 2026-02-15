# 17 — Configuration

All configurable settings are controlled via environment variables in the `.env` file.
A subset of active settings can also be viewed at runtime in the **Settings page** in the web UI.

---

## Table of Contents

- [Settings Page (Web UI)](#settings-page-web-ui)
- [The .env File](#the-env-file)
- [Database Settings](#database-settings)
- [LLM Provider Settings](#llm-provider-settings)
- [Server Settings](#server-settings)
- [Multi-user and Auth Settings](#multi-user-and-auth-settings)
- [Feature Flags](#feature-flags)
- [Docker Configuration](#docker-configuration)
- [Production Deployment Tips](#production-deployment-tips)

---

## Settings Page (Web UI)

The **Settings** page (`/settings`) provides a centralised view of all project configuration.
Open it from the **Settings** link in the top navigation bar.

The page is organised into four tabs:

| Tab                      | Contents                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------- |
| **General**              | Default source/target languages, UI language (English/Ukrainian), light/dark theme |
| **LLM / Auto-translate** | Read-only display of the active LLM provider, models, batch size, and system flags |
| **Data**                 | Quick-access cards for QA Rules, TradAuto rules, and Glossary                      |
| **Users**                | Quick-access card to the Users page _(multi-user mode only)_                       |

### General tab

Settings in the **General** tab are stored in your browser’s `localStorage`.
They have no server-side effect but pre-fill language selectors across all pages
(Imports, Editor, TMX, Coherence …).

| Setting                 | localStorage key | Default |
| ----------------------- | ---------------- | ------- |
| Default source language | `fo4-src-lang`   | `en`    |
| Default target language | `fo4-tgt-lang`   | `uk`    |
| UI language             | `ui-lang`        | `uk`    |
| Theme                   | `fo4-theme`      | `dark`  |

### LLM tab

All values are **read-only** in the UI — they reflect the currently active runtime
configuration sourced from environment variables. To change them, edit `.env`
and restart the server. The OpenAI API key is never sent to the browser; only
whether it is configured is shown.

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
# ollama (default) | openai
LLM_PROVIDER=ollama

# Fallback provider if primary is unavailable (none | ollama | openai)
LLM_FALLBACK=none

# --- Ollama ---
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gemma3:12b

# --- OpenAI (only if LLM_PROVIDER=openai) ---
# OPENAI_API_KEY=sk-...
# OPENAI_TRANSLATE_MODEL=gpt-4.1-mini
# OPENAI_EMBED_MODEL=text-embedding-3-large

# --- Database ---
DATABASE_URL=postgresql://localizer:localizer@localhost:5432/localizer
POSTGRES_USER=localizer
POSTGRES_PASSWORD=localizer
POSTGRES_DB=localizer

# --- Translation ---
# Number of strings sent to LLM per batch
BATCH_SIZE=30

# --- Logging ---
# Log level: error | warn | info | debug | trace (default: info)
LOG_LEVEL=info

# Directory for log files (default: ./logs/)
# LOG_DIR=./logs/

# --- Multi-user mode ---
# MULTI_USER=true
# SESSION_LIFETIME_HOURS=72

# --- Debug ---
# DEBUG=1
```

---

## Database Settings

| Variable       | Default      | Description                                                                      |
| -------------- | ------------ | -------------------------------------------------------------------------------- |
| `DATABASE_URL` | _(required)_ | PostgreSQL connection string, e.g. `postgresql://user:pass@localhost:5432/f4loc` |

The connection string format is:

```
postgresql://USERNAME:PASSWORD@HOST:PORT/DBNAME
```

Example: `postgresql://localizer:localizer@localhost:5432/localizer`

When using **Docker Compose**, `DATABASE_URL` is set automatically by `docker-compose.yml`
using the `db` service name as the host: `postgresql://localizer:localizer@db:5432/localizer`.
You do not need to set it manually when running the full stack with `docker compose up`.

---

## LLM Provider Settings

| Variable                 | Default                  | Description                                                       |
| ------------------------ | ------------------------ | ----------------------------------------------------------------- |
| `LLM_PROVIDER`           | `ollama`                 | Primary LLM provider: `openai` or `ollama`                        |
| `LLM_FALLBACK`           | `none`                   | Fallback provider if primary fails: `none`, `openai`, or `ollama` |
| `OPENAI_API_KEY`         | _(required for OpenAI)_  | Your OpenAI API key                                               |
| `OPENAI_TRANSLATE_MODEL` | `gpt-4.1-mini`           | OpenAI model used for translation                                 |
| `OPENAI_EMBED_MODEL`     | `text-embedding-3-large` | OpenAI model used for embeddings                                  |
| `OLLAMA_BASE_URL`        | `http://localhost:11434` | Ollama API endpoint                                               |
| `OLLAMA_MODEL`           | _(required for Ollama)_  | Ollama model name, e.g. `gemma3:12b`, `llama3`, `mistral`         |

> Note: temperature, max tokens, and retry count are not currently configurable via
> environment variables. The backend uses provider defaults.

---

## Server Settings

| Variable        | Default                 | Description                                     |
| --------------- | ----------------------- | ----------------------------------------------- |
| `PORT`          | `3000`                  | Backend HTTP server port                        |
| `HOST`          | `0.0.0.0`               | Backend bind address                            |
| `VITE_API_BASE` | `http://localhost:3000` | Frontend API base URL (used by Vite dev server) |

> Note: `PORT`, `HOST`, and `VITE_API_BASE` are read directly from `process.env` by the
> server and Vite dev server respectively. They are not part of the `CONFIG` object in
> `src/config.ts`. The defaults shown above apply when the variables are not set.

---

## Multi-user and Auth Settings

| Variable                 | Default | Description                                               |
| ------------------------ | ------- | --------------------------------------------------------- |
| `MULTI_USER`             | `false` | Set to `true` to enable login and RBAC                    |
| `SESSION_LIFETIME_HOURS` | `72`    | Session lifetime in hours; sessions expire after this TTL |

> Note: sessions are stored as tokens in the database. There is no JWT signing secret —
> `SESSION_SECRET` is not used. No additional cookie-domain or secure-flag variables exist;
> the session cookie is always HTTP-only and SameSite=Strict.

---

## Feature Flags

There are no feature flags in the current version.
All features are enabled by default and cannot be selectively disabled via environment variables.

The only optional toggle is **`MULTI_USER=true`** (described above), which activates
authentication and role-based access control.

---

## Docker Configuration

The project ships with a `docker-compose.yml` that starts:

- `backend` — the Fastify API server
- `frontend` — the Vite dev server (or a static build)
- `db` — PostgreSQL 15

### Starting the Stack

```bash
docker compose up -d
```

### Running Database Init

```bash
docker compose run --rm cli npm run db:init
```

### Stopping

```bash
docker compose down
```

### Data Persistence

PostgreSQL data is stored in a Docker volume (`pgdata`).
This volume persists across `docker compose down` and restarts.

**Backup the PostgreSQL data volume:**

```bash
docker compose exec db pg_dump -U localizer localizer > backup_$(date +%Y%m%d).sql
```

**Restore from a backup:**

```bash
cat backup_20250101.sql | docker compose exec -T db psql -U localizer localizer
```

**Access the database from the host machine:**

Add a port mapping to `docker-compose.yml` (or a local override file):

```yaml
services:
  db:
    ports:
      - '5432:5432'
```

Then connect with any PostgreSQL client (e.g. pgAdmin, DBeaver) to `localhost:5432`
using the credentials from your `.env` file.

---

## Production Deployment Tips

1. **Create a production compose override** (`docker-compose.prod.yml`):
   - Pin image tags to specific versions.
   - Remove the Vite dev server; serve the built frontend via nginx or Caddy.
   - Add `deploy.resources.limits.memory` for the backend — LLM API calls can be memory-intensive.

2. **Build the frontend bundle:**

   ```bash
   cd web-ui && npm run build
   # Serve the dist/ directory from your reverse proxy
   ```

3. **Reverse proxy (nginx / Caddy):**
   - Put a reverse proxy in front of the backend on port 3000.
   - Terminate TLS at the proxy — always run production over HTTPS.

4. **Environment variables to set in production:**
   - `DATABASE_URL` — use a strong, unique password.
   - `MULTI_USER=true` and create named user accounts.
   - `SESSION_LIFETIME_HOURS` — keep at 72h or adjust to your security policy.
   - `LLM_PROVIDER` + the appropriate API key or Ollama URL.
   - `LOG_LEVEL=warn` — reduce log verbosity in production.

5. **Database backups:**
   Schedule a daily `pg_dump` (cron or Docker sidecar):

   ```bash
   0 3 * * * docker compose -f /srv/app/docker-compose.yml exec -T db \
     pg_dump -U localizer localizer | gzip > /backups/f4loc_$(date +\%Y\%m\%d).sql.gz
   ```

6. **Persistent data** lives in the `pgdata` Docker volume.
   Never run `docker compose down -v` in production unless you intend to wipe all translation data.

---

← [Team & Users](16-team-and-users.md) | [Home](README.md) | [TradAuto](18-tradauto.md) →
