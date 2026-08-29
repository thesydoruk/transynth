# Contributing

Transynth is a single-operator localization tool. Keep changes small and match the code that is already there.

## Setup

Follow the [README](README.md) Docker or `npm run dev` path. Do not commit `.env`, `data/`, or game binaries.

```bash
npm test
npm --prefix web-ui test
```

Prettier runs on commit. Do not add `--no-verify` unless you are fixing a hook that already failed.

## Before you open a PR

Pull requests run Prettier, ESLint, `tsc`, `npm test`, `npm --prefix web-ui test`, and the web-ui build.

- One concern per PR.
- Tests for the behavior you changed, next to the source (`__tests__/` or `*.test.ts`).
- Source files stay at or under 300 non-comment lines of code — split first if you would go over.
- UI copy: add both `web-ui/src/i18n/locales/en.json` and `uk.json`.
- No homelab IPs, API keys, or machine paths.

## Layout

- `src/web` enqueues jobs through `worker/src/api`. The worker imports `src/web/data` and services. Do not grow that cycle; a shared jobs layer comes later.
- Plugin import lives in `src/import/mod`. HTTP and UI call it `modImport`. Keep both names; do not rename the tree in passing.
- Route handlers under `src/web/routes` have almost no tests. Add a colocated `*.test.ts` when you change a route.

## Security

This app has no login. Do not add features that assume the API is public. See [SECURITY.md](SECURITY.md).

## Issues

Use the GitHub templates. A bug report needs what you ran (`docker compose` vs `npm run dev`), the game id, and what you expected.
