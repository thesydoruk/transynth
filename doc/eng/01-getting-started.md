# 01 — Getting Started

Get Transynth running on your machine for the first time.

---

## Table of Contents

- [Requirements](#requirements)
- [Supported Games](#supported-games)
- [Option A: Docker (recommended)](#option-a-docker-recommended)
  - [Optional: embedded Gemma and RAG](#optional-embedded-gemma-and-rag)
- [Option B: Local Node.js](#option-b-local-nodejs)
- [First Launch: Creating the Database](#first-launch-creating-the-database)
- [Opening the Web UI](#opening-the-web-ui)
- [Next Steps](#next-steps)

---

## Requirements

- **Recommended path:** Docker Desktop with Docker Compose.
- **Local runtime:** Node.js 20+ is the practical minimum; Node.js 24 matches the Docker image used by this project.
- **Package manager:** npm (the repository ships with `package.json` / `package-lock.json`; pnpm is not required).
- **Database:** PostgreSQL 15+ for a local install. The Docker stack uses `pgvector/pgvector:pg17`.
- **Operating systems:** Windows, macOS, and Linux are all suitable for the web application. Windows is the most practical host if you also work with Fallout modding tools outside this pipeline.
- **Language:** first-class LLM prompts and glossaries are English → Ukrainian. Other targets use a generic English prompt. The UI defaults to Ukrainian. This is not a language-neutral platform.

## Supported Games

Transynth supports the following titles:

- Fallout 4 (`fo4`)
- Fallout 76 (`fo76`)
- Fallout 3 (`fo3`)
- Fallout: New Vegas (`fnv`)
- The Elder Scrolls IV: Oblivion (`ob`)
- The Elder Scrolls III: Morrowind (`mw`)
- Skyrim Special Edition (`sse`)
- Skyrim Legendary Edition (`sle`)
- Disco Elysium Final Cut (`disco`)

Archive/export behavior depends on the selected game profile:

- FO4 / FO76: BA2 workflow
- FO3 / FNV / OB / MW / SSE / SLE: BSA workflow
- Disco Elysium: Disco Translator Final Cut language packs (`.po` text + `.wav` voice)

### Disco Elysium (Final Cut)

Runtime loader: [Disco Translator Final Cut](https://github.com/Gianxs/DiscoTranslatorFinalCut) (BepInEx il2cpp).

1. Install BepInEx + Disco Translator Final Cut in the game folder.
2. From the main menu, press **c** to dump English `.po` files and **a** for reference `.wav` audio.
3. Zip a Final Cut language folder and upload it in Transynth with game = `disco`:

```text
English_English_en/
  Dialogues.po
  General.po
  Audio/
    **/*.wav
```

4. Translate in the UI. The LLM path masks lockit (`"…"`, `*italics*`,
   `'title'`, `--`); saves fold `«»` to ASCII quotes. See
   [LLM Translation](06-llm-translation.md#disco-lockit).
5. Optionally synthesize voice: set `TTS_BASE_URL` and
   `AUDIO_INTEL_BASE_URL` (Whisper cuts narration away from quotes). Compose
   does not start those services. See
   [Voice](09-voice.md#disco-what-gets-spoken).
6. Export a langpack ZIP shaped as `Ukrainian_Ukrainian_uk/*.po` (+ `Audio/*.wav`). Drop that folder next to other Final Cut languages and select it in-game.

---

## Option A: Docker (recommended)

Docker takes care of Node.js, PostgreSQL, and all dependencies automatically.
This is the easiest way to get started.

1. Install Docker Desktop.
2. Clone the repository.
3. Copy `.env.example` to `.env` in the project root.
4. Review the settings in `.env`.
   `.env.example` already enables the embedded database:
   - `COMPOSE_PROFILES=embedded-db` — starts the `db` service from `docker/compose.db.yml`
   - `DATABASE_URL=…@localhost:5433/transynth` — host tools (`npm`, `psql`)
   - `DOCKER_DATABASE_URL=…@db:5432/transynth` — containers on the Compose network
5. If you use **your own** vLLM, keep `LLM_PROVIDER=vllm` and set `VLLM_MODEL` to that server’s model. To run chat and/or RAG **in this Compose stack**, see [the overlays below](#optional-embedded-gemma-and-rag).
6. Start Postgres, Redis, the API/UI, and the job worker:

```bash
docker compose up -d
```

7. Initialise the database schema:

```bash
docker compose run --rm web npm run db:init
```

8. Open `http://localhost:3000` in your browser.

Notes:

- The `web` service serves both the Fastify API and the built React UI on port `3000`.
- Imports, translate, and voice run in the **`worker`** against **Redis**.
  `docker compose up -d` starts both. `npm run dev` needs a reachable `REDIS_URL`
  (default `redis://localhost:6379`) or jobs sit idle.
- Lip-sync / Champollion (PEX source in the editor):
  `docker compose --profile tools run --rm cli npm run tools:install`.
  One-shot `cli` commands need `--profile tools`.
- Fish Speech (`TTS_BASE_URL`) and audio-intel (`AUDIO_INTEL_BASE_URL`) are
  external; Compose does not start them. Disco voice needs both.
- If you want to stop everything later, run `docker compose down`.

### External Postgres

Do not set `COMPOSE_PROFILES` or `DOCKER_DATABASE_URL`. Point `DATABASE_URL` at your server, then start only the app services:

```bash
docker compose up -d web worker redis
docker compose run --rm web npm run db:init
```

### Optional: embedded Gemma and RAG

Two profiles, same opt-in as `embedded-db`: `embedded-vllm` (chat, `vllm-gemma`)
and `embedded-embed` (RAG, `tei-embed`). Enable either or both. Needs the NVIDIA
Container Toolkit. First start downloads models into `data/huggingface` and
`data/vllm-gemma-4-26b-a4b`.

In `.env`:

```env
COMPOSE_PROFILES=embedded-db,embedded-vllm,embedded-embed
LLM_PROVIDER=vllm
VLLM_BASE_URL=http://localhost:8011
VLLM_MODEL=gemma4:26b-a4b
VLLM_EMBED_BASE_URL=http://localhost:8013
VLLM_EMBED_MODEL=Snowflake/snowflake-arctic-embed-l-v2.0
DOCKER_VLLM_BASE_URL=http://vllm-gemma:8000
DOCKER_VLLM_EMBED_BASE_URL=http://tei-embed:80
```

`DOCKER_VLLM_*` is required when `web` / `worker` run in Compose: they cannot
see localhost on the host. Then the usual `docker compose up -d` (profiles in
`COMPOSE_PROFILES` start on their own). Health: `localhost:8011/v1/models` and
`localhost:8013/health`. Later, one service only:
`docker compose --profile embedded-vllm restart vllm-gemma`.

Production with an external pool omits both profiles. GPU, Settings → LLM, and
Blackwell: [LLM Translation](06-llm-translation.md#embedded-vllm-and-embed).

---

## Option B: Local Node.js

Use this option if you prefer to run the backend and frontend directly.

1. Install Node.js 20+ and PostgreSQL 15+.
2. Clone the repository.
3. Install backend dependencies:

```bash
npm install
```

4. Install frontend dependencies:

```bash
npm --prefix web-ui install
```

5. Copy `.env.example` to `.env`. For a Postgres you run yourself, set `DATABASE_URL` to that instance and leave `COMPOSE_PROFILES` / `DOCKER_DATABASE_URL` unset. To use the Compose database from the host, keep `DATABASE_URL=…@localhost:5433/transynth` and start only `db`: `docker compose --profile embedded-db up -d db`.
6. Create the database if it does not exist yet, then initialise the schema:

```bash
npm run db:init
```

7. Start the API, job worker, and Vite UI together (`npm run dev` does **not** start Postgres or Redis):

```bash
npm run dev
```

Background jobs need Redis (`REDIS_URL`, default `redis://localhost:6379`). Or start only the API with `npm run web:dev` and the UI with `npm --prefix web-ui run dev`.

8. Open `http://localhost:5173` in your browser.

The Vite UI proxies `/api` to `http://localhost:3000`. The API defaults to `HOST=127.0.0.1` — see [SECURITY.md](../../SECURITY.md).

To run only the GPU overlays in Compose and the API on the host: enable the
profiles as above, `docker compose up -d vllm-gemma tei-embed` (or the full
stack), and keep `VLLM_BASE_URL=http://localhost:8011` in `.env` without
`DOCKER_VLLM_*`.

---

## First Launch: Creating the Database

Before first use, the database schema must be initialised.
This is a one-time operation.

Run one of the following commands:

```bash
npm run db:init
```

or, with Docker:

```bash
docker compose run --rm web npm run db:init
```

What this does:

- Reads `sql/schema.sql` and applies it to the database from `DATABASE_URL` (or `DOCKER_DATABASE_URL` inside Compose).
- Creates the core tables and indexes for mods, strings, translations, glossary, import jobs, QA, activity, and the rest of the pipeline.
- Inserts a single `users` row (`id=1`, display name `Default`) so the activity log has someone to attribute actions to. There is **no login**, no password column, and no `sessions` table.

What it does not do:

- If `qa_rules` is empty, it inserts a starter `forbidden_chars` rule (`©®™`, warning) per game.
- It does not reset or wipe the database.

The schema is idempotent (`CREATE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`). Re-run `db:init` after pulling schema changes. There is no numbered migration folder yet. It still writes to whichever database the URL points at — check the target first.

---

## Opening the Web UI

Use the URL that matches your runtime mode:

- **Docker:** `http://localhost:3000`
- **Local frontend dev server:** `http://localhost:5173`

There is **no login**. Anyone who can reach the HTTP port can use the app — see [SECURITY.md](../../SECURITY.md).

The first screen is the **Games** catalogue (`/`). Until setup is done it shows a short checklist: configure the LLM, import a mod, run auto-translate. Pick a title to open that game’s hub (`/games/:gameId`). Imported mods live at `/games/:gameId/mods`; the editor is `/games/:gameId/mods/:id`.

The top bar is thin: the brand (games catalogue), a badge for the last game you opened, the content language pair (`SRC → TGT`), Settings (gear), and **System log** (`/system-log` — LLM / TTS / job / system lines). Glossary, Diff, and Coherence live on the game hub, not in the first row.

The game hub cards are Translate, Discover, **Quality** (that is the
[Coherence](13-coherence.md) page, not QA rules), and Terms. QA rules live under
**Settings → QA**. Voice settings are a link to Settings → Voice. When the game
already has imported mods, one Release panel is the Diff → export path.

---

## Next Steps

- Import your first mod → [Importing Mods](02-importing-mods.md)
- Set up AI translation → [LLM Translation](06-llm-translation.md)
- Configure environment variables → [Configuration](14-configuration.md)

---

← [Home](README.md) | **Next: [Importing Mods →](02-importing-mods.md)**
