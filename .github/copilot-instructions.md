# Copilot Instructions — Fallout 4 Localization Project

## Documentation language

- Documentation is in **English**, located in `docs/en/`.
- Root `README.md` — short stub with link to full docs.
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

## Temporary files

- Always clean up temporary/scratch files (e.g. `_codemod.cjs`, `_lint.json`, helper scripts) **before** committing.
- Never commit temp files to the repository.
- If a tool policy blocks deletion commands (`Remove-Item`, `del`), add temp files to `.gitignore` or ask the user to remove them manually.

## Code style

- TypeScript, ESM (`"type": "module"` in package.json).
- Strict mode enabled.
- Prefer `import` over `require()`.
- Use `src/logger.ts` (`log.info/warn/error`) instead of `console.log`.
- Shared utilities go to `src/utils/` — avoid duplicating code across CLI files.
- **Styling:** Use SCSS Modules (`*.module.scss`) for component styles in `web-ui/`. No inline styles or global CSS unless unavoidable.

## User-facing wiki (`doc/`)

- The `doc/` folder contains the **user-facing wiki** — documentation for translators who use the tool.
- **Always keep the wiki up to date.** When a feature is added, changed, or removed, update the relevant `doc/*.md` file(s) in the same commit/PR.
- If a new page is needed for the feature, create it and add it to `doc/README.md`.
- `> TODO:` placeholders in the wiki are intentional stubs — fill them in when implementing the described feature.
- Wiki pages use `> TODO:` blocks for unimplemented or unverified sections. Do not remove a `> TODO:` unless the content has been fully written.
- Navigation footers (`← Prev | Home | Next →`) must remain consistent — update them if pages are added or reordered.

## Code documentation

- **Always** add detailed English comments to every function, class, type, and non-trivial block of code.
- Write comments so that even someone with zero context can understand what the code does, why it exists, and how it works.
- Every exported function/type must have a JSDoc comment explaining purpose, parameters, return value, and side effects.
- Complex logic (algorithms, bitwise ops, SQL queries, binary formats) must have step-by-step inline comments.
- When the "why" is not obvious from the code, explain the reasoning — not just the "what".
