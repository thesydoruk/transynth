# Transynth — notes for Claude

Read [CONTRIBUTING.md](CONTRIBUTING.md) first: PR rules, the 300-line limit, the layout,
and "no homelab IPs, API keys, or machine paths" all apply. This file only adds what an
agent needs on top. Host access lives in `CLAUDE.local.md` (gitignored, may be absent).

## Map

- `src/games/<game>/` — one plugin per game; shared code goes through `src/games/contract`.
  `creation-engine/` serves every Bethesda title (`titles/` picks the game).
- `src/games/creation-engine/prompts/` — translation and verify prompts per game;
  `fo4/` is split into `kernel`, `styleLayers`, `families/*`.
- `src/games/creation-engine/data/glossary/<game>-uk.ts` — seed glossaries
  (`npm run db:seed:glossary`); the production glossary in the DB is the source they are
  regenerated from.
- `src/llm/` — model calls, `src/web/` — API and services, `worker/` — job runner,
  `web-ui/` — React UI, `scripts/` — CLI entry points (`npm run <name>`).

## Checks

`npm run lint`, `npm run build` (the type check), `npm test`; SQL changes also
`npm run test:db:up && npm run test:db`. CI runs all of them plus the web-ui suites.

## Rules

- Commit and push only when the user asks. Commit from Windows (`git` in PowerShell on
  `C:\...`), not through WSL. Never skip hooks.
- Deployment is CD: a merge to `main` reaches production. There is no rsync path.
- Production data (`localizer` DB) is read-only by default. Writes — translations,
  glossary, deletes, voice — only on the user's explicit command, guarded by the old text.
- Do not edit translation prompts (`src/games/*/prompts`, `src/llm/prompts`) unless asked.
  A prompt or heuristic change is measured on the real corpus before it ships; extra prompt
  guidance has made results worse before.
- Write multi-line scripts with the Write tool and run the file: the shell mangles
  backslashes in heredocs and `node -e`. JS `\b` is ASCII-only — next to Cyrillic use
  lookarounds such as `(?<![Ѐ-ӿ])`.
