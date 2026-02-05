# 17 — Configuration

All configurable settings are controlled via environment variables in the `.env` file.

---

## Table of Contents

- [The .env File](#the-env-file)
- [Database Settings](#database-settings)
- [LLM Provider Settings](#llm-provider-settings)
- [Server Settings](#server-settings)
- [Multi-user and Auth Settings](#multi-user-and-auth-settings)
- [Feature Flags](#feature-flags)
- [Docker Configuration](#docker-configuration)
- [Production Deployment Tips](#production-deployment-tips)

---

## The .env File

Copy `.env.example` to `.env` in the project root and fill in the required values:

```bash
cp .env.example .env
```

The `.env` file is never committed to version control.
All settings have defaults where possible; only required settings must be provided.

> TODO: Embed the contents of `.env.example` here (auto-sync note: keep in sync
> with the actual file).

---

## Database Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | *(required)* | PostgreSQL connection string, e.g. `postgresql://user:pass@localhost:5432/f4loc` |

> TODO: Explain connection string format.
> Note that Docker Compose sets `DATABASE_URL` automatically via service name.

---

## LLM Provider Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `ollama` | Primary provider: `openai` or `ollama` |
| `LLM_FALLBACK_PROVIDER` | *(none)* | Fallback provider if primary fails |
| `OPENAI_API_KEY` | *(required for OpenAI)* | Your OpenAI API key |
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI model name |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `llama3` | Ollama model name |

> TODO: Add any additional LLM settings (temperature, max tokens, retry count).
> Confirm exact variable names from `src/config.ts`.

---

## Server Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Backend HTTP server port |
| `HOST` | `0.0.0.0` | Backend bind address |
| `VITE_API_BASE` | `http://localhost:3000` | Frontend API base URL (used by Vite dev server) |

> TODO: Confirm variable names and defaults from `src/config.ts`.

---

## Multi-user and Auth Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `MULTI_USER` | `false` | Set to `true` to enable login and RBAC |
| `SESSION_SECRET` | *(required when MULTI_USER=true)* | Random secret for session signing (min 32 chars) |
| `SESSION_TTL_HOURS` | `24` | Session lifetime in hours |

> TODO: Add any additional auth variables (cookie domain, secure flag, etc.).

---

## Feature Flags

> TODO: List any feature flags that can be enabled/disabled via env vars:
> - `ENABLE_EET_IMPORT` — enable legacy EET file import
> - `ENABLE_CSV_IMPORT` — enable CSV import tab
> - etc.
> Confirm from source.

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

> TODO: Explain how to back up and restore the Docker volume.
> Explain how to access the database directly from the host (port mapping).

---

## Production Deployment Tips

> TODO: Cover:
> - Use `docker compose -f docker-compose.prod.yml up` with a production compose file.
> - Set `NODE_ENV=production`.
> - Build the frontend static bundle (`npm run build` in `web-ui/`) and serve it via nginx.
> - Use a reverse proxy (nginx / Caddy) in front of the backend.
> - Set `SESSION_SECRET` to a long random value (never the default).
> - Enable HTTPS on the reverse proxy.
> - Set up database backups (daily `pg_dump`).
> - Consider Docker resource limits (memory, CPU) for LLM calls.

---

← [Team & Users](16-team-and-users.md) | [Home](README.md)
