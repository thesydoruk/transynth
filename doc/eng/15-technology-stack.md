# 15 — Technology Stack

This page describes the core technologies used by Transynth and where each
part fits in the system.

---

## Project Overview

The project is a full-stack localization platform for Bethesda (and Disco
Elysium) mods. It combines a TypeScript backend, a BullMQ worker, PostgreSQL,
a React web UI, and npm scripts for import, translation, review, and export.

At a high level, the system supports these flows:

1. Import mod assets and extract localizable strings.
2. Store strings, metadata, translation memory, glossary data, and review state
   in PostgreSQL.
3. Run translation workflows through translation memory, rule-based automation,
   and LLM providers.
4. Review and edit translations in the web UI.
5. Export translated output back into game-compatible formats.

---

## Runtime and Language

- Node.js is the primary application runtime.
- TypeScript is used across backend, worker, and frontend code.
- The project uses ESM modules and strict type checking.
- Bash and PowerShell or batch scripts are used only for environment-level
  helpers where needed.

---

## Backend and Server-Side Application

- Fastify powers the HTTP server and API layer.
- `pg` is used for PostgreSQL access.
- `@fastify/static`, `@fastify/cors`, and `@fastify/multipart` support static
  file serving, browser access, and uploads.
- Import, translation, and export run as HTTP API jobs (BullMQ worker) or
  `npm run` scripts under `scripts/`. There is no `src/cli/` tree.

---

## Frontend

- React powers the web interface.
- Vite is used for frontend development and production builds.
- TypeScript is used in the frontend.
- SCSS Modules are used for component-scoped styling.
- Theme tokens are centralized in `web-ui/src/index.scss`.

---

## Database

- PostgreSQL stores project data, strings, metadata, and QA state,
  glossary records, and translation memory.
- SQL schema files live under `sql/`.
- Database initialization is handled through `scripts/dbInit.ts`.

---

## AI and Translation Services

- vLLM (or any OpenAI-compatible server) is supported for local LLM inference.
- OpenAI is supported for hosted LLM translation workflows.
- Provider abstractions live under `src/llm/`.

---

## File and Game-Format Processing

- Custom TypeScript readers and writers under `src/formats/` (`ba2/`, `bsa/`, `esp/`, …) process ESP, EET,
  PEX, MCM, BA2, BSA, and STRINGS-related formats.
- `archiver` and `node-7z` handle archives. Keep both `7zip-bin` (`7za`, zip/7z)
  and `7z-bin` (full `7z`, RAR) — `7za` cannot unpack RAR.
- `fast-xml-parser` is used for XML-based content.

---

## Tooling and Quality

- Root Jest covers `src/` and `worker/`. `web-ui` uses Vitest (`*.test.ts` / `*.test.tsx`).
- Tests are colocated near code in local `__tests__/` folders or `*.test.ts(x)` next to the source.
- `tsx` is used to run TypeScript files directly in development and CLI flows.
- `concurrently` and `wait-on` are used in development orchestration scripts.

### Shared UI Components

Reusable React components live in `web-ui/src/components/`. Each component has its own subfolder containing the implementation, an SCSS Module, and an `index.ts` barrel export.

Key shared components:

| Component      | Path                       | Purpose                                                                                                                                               |
| -------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PageHeader`   | `components/PageHeader/`   | Consistent page-level header: title, description, right-aligned actions slot, and optional meta strip. Used on Glossary, Settings, and similar pages. |
| `StatusBadge`  | `components/StatusBadge/`  | Semantic status pill used in string grids and coherence cards.                                                                                        |
| `OverflowMenu` | `components/OverflowMenu/` | Secondary actions collapsed into a `⋯` menu for dense row UIs.                                                                                        |
| `ConfirmModal` | `components/ConfirmModal/` | Reusable danger confirmation overlay (replaces `window.confirm`).                                                                                     |

---

## Containerization

- Docker and Docker Compose are used for local development and service
  orchestration.
- The repository includes `docker/Dockerfile` and a root `docker-compose.yml`.
- Optional overlays: `docker/compose.db.yml` (`embedded-db`),
  `docker/compose.vllm.yml` (`embedded-vllm`), `docker/compose.embed.yml`
  (`embedded-embed`).

---

## Repository Layout

- `src/` - backend application code, format parsers, CLI flows, and shared
  logic.
- `web-ui/` - frontend application.
- `scripts/` - project maintenance and database bootstrap scripts.
- `sql/` - SQL schema and related database assets.
- `docker/` - image build and optional Compose overlays (Postgres, Gemma, RAG).
- `doc/` - consolidated project documentation.

---

← [Configuration](14-configuration.md) | [Home](README.md)
