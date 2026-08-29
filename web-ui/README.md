# transynth web UI

React + TypeScript + Vite frontend for Transynth. It is not a standalone app: the Fastify API in the repo root must be running.

## Dev

From the **repository root** (so the API and worker start too):

```bash
npm run dev
```

Vite listens on port 5173 and proxies `/api` to `http://localhost:${PORT}` (default 3000).

UI-only, if the API is already up:

```bash
npm --prefix web-ui install
npm --prefix web-ui run dev
```

## Tests

```bash
npm --prefix web-ui test
```

Vitest runs `src/**/*.test.ts` (pure helpers) and `src/**/*.test.tsx` (page smokes). Root `npm test` is Jest for the API and worker only.

## Build

The Docker `web` image builds this package into `web-ui/dist` and Fastify serves it on port 3000.

```bash
npm --prefix web-ui run build
```

i18n files: `src/i18n/locales/en.json` and `uk.json`. Default language is Ukrainian.
