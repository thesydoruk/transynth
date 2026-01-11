# Copilot Instructions — Fallout 4 Localization Project

## Documentation language

- **All documentation is bilingual: Ukrainian (primary) and English.**
- Primary language is **Ukrainian**. English is added as a translation.
- Documentation is organized by language in separate folders:
  - Root (`README.md`, `ROADMAP.md`) — short bilingual stubs with links.
  - `docs/uk/` — **Ukrainian** (primary, full documentation).
  - `docs/en/` — English version.
- When updating docs — update **both** language versions.
- Code comments — in **English** (standard practice for OSS compatibility).
- Commit messages — in **English**.

## Docker

- Use Docker wherever appropriate.
- **Appropriate:** dev environment, CI/CD, CLI pipeline (translate, learn, db:init).
- Dockerfile(s) in root or `.docker/`.
- docker-compose.yml for orchestration.
- .dockerignore is mandatory.
- Multi-stage builds where it reduces image size.
- Official Node.js images with Python for native builds.

## Workflow

- **Never make changes to code or files without explicit user confirmation.**
- Before any modification — describe the plan and wait for approval.

## Code style

- TypeScript, ESM (`"type": "module"` in package.json).
- Strict mode enabled.
- Prefer `import` over `require()`.
- Use `src/logger.ts` (`log.info/warn/error`) instead of `console.log`.
- Shared utilities go to `src/utils/` — avoid duplicating code across CLI files.
