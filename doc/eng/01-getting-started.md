# 01 — Getting Started

Get the Fallout 4 Localization Pipeline running on your machine for the first time.

---

## Table of Contents

- [Requirements](#requirements)
- [Option A: Docker (recommended)](#option-a-docker-recommended)
- [Option B: Local Node.js](#option-b-local-nodejs)
- [First Launch: Creating the Database](#first-launch-creating-the-database)
- [Opening the Web UI](#opening-the-web-ui)
- [Login and Multi-user Mode](#login-and-multi-user-mode)
- [Next Steps](#next-steps)

---

## Requirements

- **Recommended path:** Docker Desktop with Docker Compose.
- **Local runtime:** Node.js 20+ is the practical minimum; Node.js 24 matches the Docker image used by this project.
- **Package manager:** npm (the repository ships with `package.json` / `package-lock.json`; pnpm is not required).
- **Database:** PostgreSQL 15+ for a local install. The Docker stack uses `postgres:17-alpine`.
- **Operating systems:** Windows, macOS, and Linux are all suitable for the web application. Windows is the most practical host if you also work with Fallout modding tools outside this pipeline.

---

## Option A: Docker (recommended)

Docker takes care of Node.js, PostgreSQL, and all dependencies automatically.
This is the easiest way to get started.

1. Install Docker Desktop.
2. Clone the repository.
3. Copy `.env.example` to `.env` in the project root.
4. Review the settings in `.env`.
   The default database settings already point to a local PostgreSQL instance created by Docker Compose:
   - `POSTGRES_USER=localizer`
   - `POSTGRES_PASSWORD=localizer`
   - `POSTGRES_DB=localizer`
   - `DATABASE_URL=postgresql://localizer:localizer@localhost:5432/localizer`
5. If you use Ollama, keep `LLM_PROVIDER=ollama` and set `OLLAMA_MODEL` to a model that already exists in your Ollama installation.
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

The top app bar now also shows:

- a dedicated **Home** entry in the main navigation
- the current **Game** workspace badge, persisted from the last game-scoped route you opened
- the current **Content** language pair (`SRC → TGT`), mirroring the source/target language defaults from Settings

When you open a game workspace (`/games/:gameId`), the **Game Hub** now serves as a workflow landing page with direct cards for:

- **Import**
- **Translate**
- **Quality**
- **Release**

plus a secondary **Discover** card for NexusMods browsing.

The **Release** area now also includes an explicit two-step workflow panel:

1. **Open Diff** to compare updated versions and carry over translations.
2. **Open Imported Mods** to return to the mod editor and export STRINGS, BA2, or ZIP after review and QA are complete.

In the game-scoped Nexus browser (`/games/:gameId/nexus`), empty search results now include direct actions to clear the search and jump back to the game hub.

---

## Login and Multi-user Mode

The tool can run in **single-user mode** (no login required, default) or
**multi-user mode** (accounts, roles, audit trail).

By default, the application runs in **single-user mode**:

- No login screen is shown.
- The backend injects the default admin identity automatically.
- User management is disabled.

To enable **multi-user mode**, add this to `.env` and restart the backend:

```bash
MULTI_USER=true
```

What changes when multi-user mode is enabled:

- The login page appears before the rest of the app.
- Sessions are stored in the database and authenticated with an HTTP-only cookie.
- Role-based access control becomes active.
- The **Users** page becomes available so admins can create accounts, disable users, and manage passwords.

In multi-user mode, the app shell also exposes a small role-aware shortcut badge next to the current Game and Content badges:

- **Reviewers** get a direct shortcut to **Review Queue**.
- **Admins** get a direct shortcut to **Users**.
- **Translators** keep the main shell focused on the translation surfaces without extra admin links.

Default bootstrap account:

- **Username:** `admin`
- **Password:** `admin`

Change this password immediately after the first multi-user login.
The application supports password changes for user accounts in multi-user mode, and admins can manage other users from the Users section.

For roles, permissions, and team workflow details, see [Team & Users](16-team-and-users.md).

---

## Next Steps

- Import your first mod → [Importing Mods](02-importing-mods.md)
- Set up AI translation → [LLM Translation](06-llm-translation.md)
- Configure environment variables → [Configuration](17-configuration.md)

---

← [Home](README.md) | **Next: [Importing Mods →](02-importing-mods.md)**
