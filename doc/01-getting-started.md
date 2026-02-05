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

> TODO: List exact versions — Node.js, pnpm/npm, PostgreSQL, Docker, OS compatibility notes.

---

## Option A: Docker (recommended)

Docker takes care of Node.js, PostgreSQL, and all dependencies automatically.
This is the easiest way to get started.

> TODO: Step-by-step Docker setup:
> 1. Install Docker Desktop.
> 2. Clone the repository.
> 3. Copy `.env.example` to `.env` and fill required values.
> 4. `docker compose up -d`.
> 5. `docker compose run --rm cli npm run db:init`.
> 6. Open `http://localhost:5173` in the browser.

---

## Option B: Local Node.js

Use this option if you prefer to run the backend and frontend directly.

> TODO: Step-by-step local setup:
> 1. Install Node.js 20+.
> 2. Install PostgreSQL 15+.
> 3. Clone the repository.
> 4. `npm install`.
> 5. Copy `.env.example` to `.env` and configure `DATABASE_URL`.
> 6. `npm run db:init`.
> 7. `npm run dev` (starts both backend and frontend concurrently).

---

## First Launch: Creating the Database

Before first use, the database schema must be initialised.
This is a one-time operation.

> TODO: Explain `npm run db:init` / `docker compose run --rm cli npm run db:init`.
> Explain what it creates (tables, indexes, default QA rules).
> Warn about data loss if run on an existing database.

---

## Opening the Web UI

> TODO: URL, expected landing page (Mods list), screenshot placeholder.

---

## Login and Multi-user Mode

The tool can run in **single-user mode** (no login required, default) or
**multi-user mode** (accounts, roles, audit trail).

> TODO: Explain `MULTI_USER=true` env variable.
> Describe the login screen.
> List default admin credentials and how to change them.
> Link to [Team & Users](16-team-and-users.md) for full role documentation.

---

## Next Steps

- Import your first mod → [Importing Mods](02-importing-mods.md)
- Set up AI translation → [LLM Translation](06-llm-translation.md)
- Configure environment variables → [Configuration](17-configuration.md)

---

← [Home](README.md) | **Next: [Importing Mods →](02-importing-mods.md)**
