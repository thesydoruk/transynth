# Copilot Instructions — Fallout 4 Localization Project

## Мова документації / Documentation language

- **Вся документація ведеться двома мовами: українською (основна) та англійською.**
- Основна мова — **українська**. Англійська додається як переклад.
- Документація розділена по папках за мовою:
  - Корінь (`README.md`, `ROADMAP.md`) — коротка двомовна заглушка з посиланнями.
  - `docs/uk/` — **українська** (основна повна документація).
  - `docs/en/` — англійська версія.
- При зміні документації — оновлювати **обидві** мовні версії.
- Коментарі в коді — **англійською** (стандартна практика для OSS-сумісності).
- Commit messages — **англійською**.

> **All documentation is bilingual: Ukrainian (primary) and English.**
> Root-level docs are in Ukrainian. English versions live in `docs/en/`.
> When updating docs, update both language versions.
> Code comments and commit messages stay in English.

## Docker

- По максимуму використовувати Docker де це доречно.
- **Доречно:** dev-середовище, CI/CD, CLI pipeline (translate, learn, db:init).
- **Не доречно:** xEdit (FO4Edit) — Windows-only GUI, залишається на хості.
- Dockerfile(и) у корені або `.docker/`.
- docker-compose.yml для оркестрації.
- .dockerignore обов'язковий.
- Multi-stage builds де це зменшує розмір образу.
- Офіційні Node.js образи з Python для native builds.

## Code style

- TypeScript, ESM (`"type": "module"` in package.json).
- Strict mode enabled.
- Prefer `import` over `require()`.
- Use `src/logger.ts` (`log.info/warn/error`) instead of `console.log`.
- Shared utilities go to `src/utils/` — avoid duplicating code across CLI files.
