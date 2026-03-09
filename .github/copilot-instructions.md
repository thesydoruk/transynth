# Copilot Instructions — Fallout 4 Localization Project

## Documentation language

- Documentation is maintained in **two languages**: Ukrainian and English.
- Root `README.md` is a short stub linking to the full docs.
- `doc/uk/` contains Ukrainian documentation.
- `doc/eng/` contains English documentation.
- When documentation changes, update both language versions unless the change is explicitly language-specific.
- Code comments are in **English**.
- Commit messages are in **English**.

## Docker

- Use Docker wherever appropriate.
- Appropriate uses: dev environment, CI/CD, CLI pipeline (`translate`, `learn`, `db:init`).
- Keep Dockerfile(s) in the root or `.docker/`.
- Use `docker-compose.yml` for orchestration.
- .dockerignore is mandatory.
- Use multi-stage builds when they reduce image size.
- Prefer official Node.js images with Python for native builds.

## Workflow

- For small, localized, low-risk changes, make the change directly and report what was done.
- Ask for confirmation only for destructive actions, broad refactors, dependency changes, schema changes, or ambiguous requirements.

## Efficiency rules

- Minimize tool calls and token usage when this does not reduce correctness.
- Prefer one short explicit assumption over a clarification question when the risk is low.
- Ask questions only when a wrong assumption could cause data loss, architectural drift, or substantial rework.
- Batch related reads before responding and avoid re-reading the same files unless something changed.
- Keep progress updates sparse: send them after meaningful milestones, blocks, or material plan changes.
- Keep final answers brief by default: outcome, validation, and only important risks or follow-up items.
- When multiple valid approaches exist, choose the simplest one that fits the codebase and state the assumption briefly.

## Temporary files

- Always clean up temporary or scratch files (for example `_codemod.cjs`, `_lint.json`, helper scripts) **before** committing.
- Never commit temp files to the repository.
- If a tool policy blocks deletion commands (`Remove-Item`, `del`), add temp files to `.gitignore` or ask the user to remove them manually.

## Code style

- TypeScript, ESM (`"type": "module"` in package.json).
- Strict mode enabled.
- Prefer `import` over `require()`.
- Use `src/logger.ts` (`log.info/warn/error`) instead of `console.log`.
- Put shared utilities in `src/utils/` instead of duplicating code across CLI files.
- **Styling:** Use SCSS Modules (`*.module.scss`) for component styles in `web-ui/`. No inline styles or global CSS unless unavoidable.
- **Theme colors only:** All colors in `web-ui/` styles must come from theme tokens defined in `web-ui/src/index.scss` (e.g. `var(--...)`). Do not use raw color literals (`#...`, `rgb(...)`, `rgba(...)`, `hsl(...)`, `color-mix(...)`) directly in component/module styles.

## User-facing wiki (`doc/`)

- The `doc/` folder is the **user-facing wiki** for translators.
- **Always keep the wiki up to date.** When a feature is added, changed, or removed, update the relevant files in `doc/eng/` and `doc/uk/` in the same commit or PR.
- If a new page is needed for the feature, create it in both language folders and add it to `doc/README.md`, `doc/eng/README.md`, and `doc/uk/README.md`.
- `> TODO:` placeholders in the wiki are intentional stubs — fill them in when implementing the described feature.
- Wiki pages use `> TODO:` blocks for unimplemented or unverified sections. Do not remove a `> TODO:` unless the content has been fully written.
- Navigation footers (`← Prev | Home | Next →`) must remain consistent — update them if pages are added or reordered.

## Code documentation

- **Always** add detailed English comments to every function, class, type, and non-trivial block of code.
- Write comments so that someone with zero context can understand what the code does, why it exists, and how it works.
- Every exported function or type must have a JSDoc comment explaining purpose, parameters, return value, and side effects.
- Complex logic such as algorithms, bitwise operations, SQL queries, and binary formats must have step-by-step inline comments.
- When the "why" is not obvious from the code, explain the reasoning — not just the "what".
