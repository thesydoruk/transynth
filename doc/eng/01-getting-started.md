# 01 — Getting Started

Get Transynth (TSN) running on your machine for the first time.

---

## Table of Contents

- [Requirements](#requirements)
- [Supported Games](#supported-games)
- [Option A: Docker (recommended)](#option-a-docker-recommended)
- [Option B: Local Node.js](#option-b-local-nodejs)
- [First Launch: Creating the Database](#first-launch-creating-the-database)
- [Opening the Web UI](#opening-the-web-ui)
- [Next Steps](#next-steps)

---

## Requirements

- **Recommended path:** Docker Desktop with Docker Compose.
- **Local runtime:** Node.js 20+ is the practical minimum; Node.js 24 matches the Docker image used by this project.
- **Package manager:** npm (the repository ships with `package.json` / `package-lock.json`; pnpm is not required).
- **Database:** PostgreSQL 15+ for a local install. The Docker stack uses `postgres:18-alpine`.
- **Operating systems:** Windows, macOS, and Linux are all suitable for the web application. Windows is the most practical host if you also work with Fallout modding tools outside this pipeline.

## Supported Games

Transynth supports the following Bethesda titles:

- Fallout 4 (`fo4`)
- Fallout 76 (`fo76`)
- Fallout 3 (`fo3`)
- Fallout: New Vegas (`fnv`)
- The Elder Scrolls IV: Oblivion (`ob`)
- The Elder Scrolls III: Morrowind (`mw`)
- Skyrim Special Edition (`sse`)
- Skyrim Legendary Edition (`sle`)

Archive/export behavior depends on the selected game profile:

- FO4 / FO76: BA2 workflow
- FO3 / FNV / OB / MW / SSE / SLE: BSA workflow

---

## Option A: Docker (recommended)

Docker takes care of Node.js, PostgreSQL, and all dependencies automatically.
This is the easiest way to get started.

1. Install Docker Desktop.
2. Clone the repository.
3. Copy `.env.example` to `.env` in the project root.
4. Review the settings in `.env`.
   The default database settings already point to a local PostgreSQL instance created by Docker Compose:
   - `DATABASE_URL=postgresql://localizer:localizer@localhost:5433/localizer`
5. If you use vLLM, keep `LLM_PROVIDER=vllm` and set `VLLM_MODEL` to the model served by your inference server.
6. Start the database and web server:

```bash
docker compose up -d db web
```

7. Initialise the database schema:

```bash
docker compose run --rm cli npm run db:init
```

8. Open `http://localhost:3000` in your browser.

Notes:

- The `web` service serves both the Fastify API and the built React UI on port `3000`.
- The `cli` service is a one-shot container for commands such as `db:init`, translation, and import/export workflows.
- If you want to stop everything later, run `docker compose down`.

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

5. Copy `.env.example` to `.env` and set `DATABASE_URL` to your local PostgreSQL database.
6. Create the database if it does not exist yet, then initialise the schema:

```bash
npm run db:init
```

7. Start the backend API in one terminal:

```bash
npm run web:dev
```

8. Start the frontend Vite dev server in a second terminal:

```bash
npm --prefix web-ui run dev
```

9. Open `http://localhost:5173` in your browser.

Important:

- In local development, the React UI runs on port `5173` and proxies API requests to `http://localhost:3000`.
- The convenience script `npm run dev` is a mixed local/Docker workflow. It starts the database with `docker compose up db`, then runs the backend locally on `3000` and the frontend locally on `5173`.

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
docker compose run --rm cli npm run db:init
```

What this does:

- Reads `sql/schema.sql` and applies it to the database from `DATABASE_URL`.
- Creates the core tables and indexes for mods, records, source strings, translations, translation history, glossary terms, import jobs, QA issues, QA rules, sessions, users, activity log, and translation cache.
- Inserts the bootstrap `admin` user row if it does not already exist.

What it does not do:

- It does not seed any default QA rules. The `qa_rules` table is created empty.
- It does not reset or wipe the database.

Safety notes:

- The schema is written to be idempotent: it uses `CREATE IF NOT EXISTS`, `ALTER ... IF NOT EXISTS`, and `ON CONFLICT DO NOTHING`, so it is safe to re-run during normal setup.
- Even though it is not a destructive reset command, it still modifies whichever database `DATABASE_URL` points to. Double-check the target before running it against a shared or important database.
- The placeholder `admin` row is created by the schema. When the web server starts, it ensures that this account has a real password hash.

---

## Opening the Web UI

Use the URL that matches your runtime mode:

- **Docker:** `http://localhost:3000`
- **Local frontend dev server:** `http://localhost:5173`

On first successful launch, the application opens on the **Mods** page (`/`).
This is the main landing page for browsing imported mods and opening the editor.

The top app bar also shows:

- a dedicated **Home** entry in the main navigation
- the current **Game** workspace badge, persisted from the last game-scoped route you opened
- the current **Content** language pair (`SRC → TGT`), mirroring the source/target language defaults from Settings

When you open a game workspace (`/games/:gameId`), the **Game Hub** serves as a workflow landing page with direct cards for:

- **Import**
- **Translate**
- **Quality**
- **Release**

plus a secondary **Discover** card for NexusMods browsing.

The **Release** area also includes an explicit two-step workflow panel:

1. **Open Diff** to compare updated versions and carry over translations.
2. **Open Imported Mods** to return to the mod editor and export STRINGS, BA2, or ZIP after review and QA are complete.

In the game-scoped Nexus browser (`/games/:gameId/nexus`), empty search results include direct actions to clear the search and jump back to the game hub.

---

## Next Steps

- Import your first mod → [Importing Mods](02-importing-mods.md)
- Set up AI translation → [LLM Translation](06-llm-translation.md)
- Configure environment variables → [Configuration](17-configuration.md)

---

← [Home](README.md) | **Next: [Importing Mods →](02-importing-mods.md)**
