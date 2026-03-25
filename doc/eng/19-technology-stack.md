# 19 — Technology Stack

This page describes the core technologies used by the Fallout 4 Localization
Pipeline and where each part fits in the system.

---

## Project Overview

The project is a full-stack localization platform for Bethesda mod files. It
combines a TypeScript backend, PostgreSQL storage, a React-based web UI, and a
set of CLI workflows for importing, translating, reviewing, and exporting mod
localization data.

At a high level, the system supports these flows:

1. Import Fallout 4 mod assets and extract localizable strings.
2. Store strings, metadata, translation memory, glossary data, and review state
   in PostgreSQL.
3. Run translation workflows through translation memory, rule-based automation,
   and LLM providers.
4. Review and edit translations in the web UI.
5. Export translated output back into game-compatible formats.

---

## Runtime and Language

- Node.js is the primary application runtime.
- TypeScript is used across backend, CLI, and frontend code.
- The project uses ESM modules and strict type checking.
- Bash and PowerShell or batch scripts are used only for environment-level
  helpers where needed.

---

## Backend and Server-Side Application

- Fastify powers the HTTP server and API layer.
- `pg` is used for PostgreSQL access.
- `@fastify/static`, `@fastify/cors`, and `@fastify/multipart` support static
  file serving, browser access, and uploads.
- CLI entry points under `src/cli/` drive import, translation, learning,
  replacement, and export workflows.

---

## Frontend

- React powers the web interface.
- Vite is used for frontend development and production builds.
- TypeScript is used in the frontend.
- SCSS Modules are used for component-scoped styling.
- Theme tokens are centralized in `web-ui/src/index.scss`.

---

## Database

- PostgreSQL stores project data, strings, metadata, QA state, review queues,
  glossary records, and translation memory.
- SQL schema files live under `sql/`.
- Database initialization is handled through `scripts/dbInit.ts`.

---

## AI and Translation Services

- Ollama is supported for local LLM inference.
- OpenAI is supported for hosted LLM translation workflows.
- Provider abstractions live under `src/llm/`.

---

## File and Game-Format Processing

- Custom TypeScript readers and writers under `src/bethesda/` process ESP, EET,
  PEX, MCM, BA2, BSA, and STRINGS-related formats.
- `archiver`, `node-7z`, and `7zip-bin` are used for archive generation and
  archive handling where required.
- `fast-xml-parser` is used for XML-based content.

---

## Tooling and Quality

- ESLint is used for linting.
- Prettier is used for formatting.
- Jest is used for unit testing.
- Tests are colocated near code in local `__tests__/` folders under `src/`.
- `tsx` is used to run TypeScript files directly in development and CLI flows.
- `concurrently` and `wait-on` are used in development orchestration scripts.

### UX Baseline Instrumentation

The repository includes a lightweight benchmark script to capture UX-facing API latency baselines for roadmap tracking.

- Script: `scripts/uxBaseline.ts`
- Command: `npm run ux:baseline -- --base-url http://localhost:3000 --samples 5 --warmup 1 --out logs/ux-baseline.json`
- Measured endpoints: dashboard stats, mods list, import jobs list, editor strings page, TM suggestions lookup.

Use this script while the web server is running against a representative dataset, then attach the generated JSON report to roadmap updates.

### Shared UI Components

Reusable React components live in `web-ui/src/components/`. Each component has its own subfolder containing the implementation, an SCSS Module, and an `index.ts` barrel export.

Key shared components:

| Component | Path | Purpose |
|---|---|---|
| `PageHeader` | `components/PageHeader/` | Consistent page-level header: title, description, right-aligned actions slot, and optional meta strip. Applied to GlossaryPage, ReviewQueuePage, ImportsPage, and SettingsPage. |
| `StatusBadge` | `components/StatusBadge/` | Semantic status pill used in string grids, coherence cards, and review queue rows. |
| `OverflowMenu` | `components/OverflowMenu/` | Secondary actions collapsed into a `⋯` menu for dense row UIs. |
| `ConfirmModal` | `components/ConfirmModal/` | Reusable danger confirmation overlay (replaces `window.confirm`). |

---

## Containerization

- Docker and Docker Compose are used for local development and service
  orchestration.
- The repository includes a root `Dockerfile` and `docker-compose.yml`.

---

## Repository Layout

- `src/` - backend application code, format parsers, CLI flows, and shared
  logic.
- `web-ui/` - frontend application.
- `scripts/` - project maintenance and database bootstrap scripts.
- `sql/` - SQL schema and related database assets.
- `doc/` - consolidated project documentation.

---

← [TradAuto Rules](18-tradauto.md) | [Home](README.md)
