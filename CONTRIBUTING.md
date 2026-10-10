# Contributing

Transynth is a single-operator localization tool. Keep changes small and match the code that is already there.

## Setup

Follow the [README](README.md) Docker or `npm run dev` path. Do not commit `.env`, `data/`, or game binaries.

```bash
npm test
npm run test:db:up && npm run test:db
npm --prefix web-ui test
npm --prefix web-ui run test:devices
```

`test:db` runs the `*.db.test.ts` files against a real Postgres — the same
pgvector image production uses — so SQL is tested as SQL, not as a mocked call.
`test:db:up` starts a throwaway one from `docker/compose.test-db.yml` on port 55433,
data in RAM; `test:db:down` stops it. To use another server set `TEST_DATABASE_URL`;
the suite drops and recreates that database on every run, so its name must end in
`_test`. Fixtures and the per-test reset live in `src/testing/testDb.ts`.

`test:devices` opens every page on a desktop, a laptop, an iPad both ways round and
three phones down to 320px, in Chromium and WebKit, against a fake API
(`web-ui/e2e/mockApi.ts`). Run `npx playwright install chromium webkit` in `web-ui/`
once first. A page that grows wider than the screen, a top-bar control that falls off
it or is too small to tap, or an editor line a finger cannot open fails the run.

Prettier runs on commit. Do not add `--no-verify` unless you are fixing a hook that already failed.

## Before you open a PR

Pull requests run Prettier, ESLint, `tsc`, `npm test`, the database tests, `npm --prefix web-ui test`, the device tests, and the web-ui build.

- One concern per PR.
- Tests for the behavior you changed, next to the source (`__tests__/` or `*.test.ts`).
- Source files stay at or under 300 non-comment lines of code — split first if you would go over.
- UI copy: add both `web-ui/src/i18n/locales/en.json` and `uk.json`.
- No homelab IPs, API keys, or machine paths.

## Layout

- `src/web` enqueues jobs through `worker/src/api`. The worker imports `src/web/data` and services. Do not grow that cycle; a shared jobs layer comes later.
- Plugin import lives in `src/import/mod`. HTTP and UI call it `modImport`. Keep both names; do not rename the tree in passing.
- Games are plugins under `src/games/`. Shared code must never compare a game id to a literal — add to the contract in `src/games/contract` instead. See [Adding a Game](doc/eng/17-adding-a-game.md).
- Route handlers under `src/web/routes` have almost no tests. Add a colocated `*.test.ts` when you change a route.

## Security

This app has no login. Do not add features that assume the API is public. See [SECURITY.md](SECURITY.md).

## Issues

Use the GitHub templates. A bug report needs what you ran (`docker compose` vs `npm run dev`), the game id, and what you expected.
