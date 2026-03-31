# Copilot Instructions — Transynth (TSN)

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
- Never run `git push` automatically. Push to remote only when the user explicitly asks for it in the current conversation.

## Roadmap status notation

- For roadmap/audit/progress markdown files in `test/` and `doc/`, use one unified status-symbol system.
- Status legend is mandatory:
  - `✅` implemented and working.
  - `🔲` planned / not implemented.
  - `❓` questionable value for web implementation.
- Prefer these symbols over markdown checkboxes (`- [x]`, `- [ ]`) and over plain text labels like "DONE/PENDING".
- Keep status notation consistent inside one file; do not mix symbol systems.

## Efficiency rules

- Minimize tool calls and token usage when this does not reduce correctness.
- Prefer one short explicit assumption over a clarification question when the risk is low.
- Ask questions only when a wrong assumption could cause data loss, architectural drift, or substantial rework.
- Batch related reads before responding and avoid re-reading the same files unless something changed.
- Keep progress updates sparse: send them after meaningful milestones, blocks, or material plan changes, unless a higher-priority runtime policy requires a different cadence.
- Keep final answers brief by default: outcome, validation, and only important risks or follow-up items, unless the user explicitly asks for more detail.
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
- Put truly shared, cross-feature utilities in `src/utils/` instead of duplicating code across CLI files.
- **Utility structure (mandatory):** place feature-local utilities in a local `utils/` subfolder near the feature/page; use `src/utils/` only when the utility is genuinely shared across modules.
- **One function per file (mandatory):** each utility file must define exactly one function (or one exported constant function).
- **Utility barrels (mandatory):** every `utils/` folder must include `index.ts` that re-exports all utility functions from that folder.
- **Component structure (mandatory):** for non-trivial pages/features in `web-ui/src/`, place UI parts in a local `components/` folder next to the page entry file (same level as local `hooks/` and `utils/` when they exist).
- **One component per folder (mandatory):** each component must live in its own subfolder inside `components/` (for example `components/EditorToolbar/`).
- **Component file layout (mandatory):** each component folder must contain the component implementation file, its SCSS Module, and an `index.ts` barrel export.
- **Page orchestration rule (mandatory):** keep page entry files focused on orchestration (state, hook wiring, layout), while reusable visual blocks live in `components/`.
- **Scaffold defaults (mandatory):** when creating or refactoring a non-trivial page in `web-ui/src/`, use this default structure (omit folders only when clearly unnecessary):

  ```
  FeaturePage/
  	FeaturePage.tsx
  	FeaturePage.module.scss
  	index.ts
  	components/
  		SomeComponent/
  			SomeComponent.tsx
  			SomeComponent.module.scss
  			index.ts
  	hooks/
  		useSomething.ts
  		index.ts
  	utils/
  		someHelper.ts
  		index.ts
  ```

- **Scaffold naming (mandatory):** page entry file name must match folder name; component file name must match component folder name; hook files must start with `use`; utility files must be function-oriented and descriptive.
- **Scaffold barrel rule (mandatory):** `components/`, `hooks/`, and `utils/` must expose exports through local `index.ts` barrels; imports in the page should prefer these barrels over deep file paths.
- **Scaffold extraction trigger (mandatory):** if a page exceeds ~300 lines, or mixes rendering with heavy business logic, extract logic into `hooks/` and repeated transformations/helpers into `utils/`.
- **Do/Don't quick rules (mandatory):**
  - **Do:** keep page files orchestration-only (state wiring, high-level layout, handlers composition).
  - **Do:** move reusable visual blocks to `components/` and keep each block isolated in its own folder.
  - **Do:** move reusable logic and side effects to `hooks/`, especially when logic is shared or hard to scan inline.
  - **Do:** move pure transformations/parsers/calculations to `utils/` with one function per file.
  - **Don't:** place multiple unrelated components in one file.
  - **Don't:** mix heavy business logic and JSX rendering in the same large page file.
  - **Don't:** import deep internal files when a local barrel (`index.ts`) exists.
  - **Don't:** keep duplicated helper logic across components; extract and reuse via `hooks/` or `utils/`.
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

- Use English for all code comments and documentation.
- Document exported APIs and non-obvious logic so that a new contributor can understand what the code does, why it exists, and how it works.
- Every exported function or type must have a JSDoc comment explaining purpose, parameters, return value, and side effects.
- Complex logic such as algorithms, bitwise operations, SQL queries, and binary formats must have step-by-step inline comments.
- Avoid redundant comments for obvious code.
- When the "why" is not obvious from the code, explain the reasoning — not just the "what".
