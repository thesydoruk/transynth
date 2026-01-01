# Roadmap

> **Українська версія:** [../uk/ROADMAP.md](../uk/ROADMAP.md)

---

## Phase 0 — LLM Provider, Ollama & Critical Fixes ⚡🦙 `v0.2`

> Provider abstraction, Ollama integration (primary backend), critical bug fixes.

- [x] **Provider abstraction** — `src/llm/provider.ts` with a unified `LLMProvider` interface (`chat`, `embed` methods); backends `ollama` | `openai`
- [x] **Ollama provider** — OpenAI-compatible client pointing to `http://localhost:11434/v1` via OpenAI SDK with custom `baseURL`
- [x] **Config: `LLM_PROVIDER`** — env var to select provider (`ollama` | `openai`, **default: `ollama`**)
- [x] **Config: `OLLAMA_BASE_URL`** — default `http://localhost:11434`
- [x] **Config: `OLLAMA_MODEL`** — model name for Ollama (e.g., `llama3`, `mistral`, `gemma2`)
- [x] **Config: `OPENAI_TRANSLATE_MODEL`** — default `gpt-4.1-mini` (was `gpt-5.1-mini`)
- [x] **Fix translate pipeline** — rewrite `src/openai/translate.ts` → `src/llm/translate.ts` using `LLMProvider.chat()` (fixes broken `openai.responses.create()`)
- [x] **Embedding support** — `LLMProvider.embed()` — local embeddings via Ollama, OpenAI `text-embedding-3-large` as alternative
- [x] **Config validation** — fail-fast on startup: check `OPENAI_API_KEY` (if provider=openai), Ollama reachability (if provider=ollama)
- [x] **Fix `require()` in ESM** — `src/utils/file.ts` — replace `require('crypto')` with `import crypto`
- [x] **Create `.env.example`** — with all LLM variables, `DATABASE_PATH`, etc.

---

## Phase 1 — Data Integrity 🛡️ `v0.3`

> Reliable CSV pipeline, correct data handling.

- [ ] **Centralized CSV parser** — extract `parseCsv()` / `csvRow()` into `src/utils/csv.ts` (RFC 4180, escaped quotes support)
- [ ] **Add EDID column to `ExportTextForTranslation.pas`** — required for alignment anchors
- [ ] **Multi-language export** — export all text entries for every language present in the plugin (not just one source/target pair); needed for multilang learning and alignment
- [ ] **Fix `upsertMod()`** — `INSERT OR IGNORE` + SELECT, handle `undefined` row
- [ ] **Fix `unmask()` ordering** — sort keys by length (longest first)
- [ ] **Spawn error handling** — add `p.on('error', ...)` to `runExport.ts`

---

## Phase 2 — Docker & Dev Experience 🐳 `v0.4`

> Dockerization, unified dev environment.

- [ ] **Dockerfile** — multi-stage build (Node.js + Python for native modules)
- [ ] **docker-compose.yml** — services: `cli`, `dev`, optional `ollama` (GPU passthrough)
- [ ] **.dockerignore** — node_modules, dist, .env, *.sqlite
- [ ] **devDependencies** — move `@types/*`, `typescript`, `tsx` from dependencies
- [ ] **Add `@types/node`**, `@types/better-sqlite3`

---

## Phase 3 — Reliability & Observability 🔧 `v0.5`

> Error handling, logging, retry logic.

- [ ] **Error handling** — try-catch on all async operations (xEdit spawn, LLM API, file I/O)
- [ ] **Use `logger.ts`** — replace `console.log` with `log.info/warn/error` across the codebase
- [ ] **LLM retry + rate limiting** — retry with exponential backoff on 429/500 (for both providers)
- [ ] **Batch size config** — extract `30` to CONFIG, add `BATCH_SIZE` env var
- [ ] **Enable DB storage in `translateMod.ts`** — uncomment and complete `addTranslation()`
- [ ] **Input validation** — verify files exist before operations
- [ ] **Fallback strategy** — try primary provider, fall back to alternative if unavailable (configurable)

---

## Phase 4 — Code Quality 📐 `v0.6`

> Refactoring, tests, linting.

- [ ] **Deduplicate** — PLACEHOLDER_RE, ingestCsvRows, parseCsv → shared modules
- [ ] **Remove dead code** — `fileHashSha1()`, unused tables `kv_cache`
- [ ] **ESLint + Prettier** — add configs and npm scripts
- [ ] **Unit tests (vitest)** — `parseCsv`, `mask/unmask` round-trip, `alignPairs`, `normalizeForHash`
- [ ] **Integration tests** — translate pipeline with mock LLM provider
- [ ] **Fix `ApplyTranslationsInPlace.pas`** — load CSV into map by FormID+Path instead of sequential reading

---

## Phase 5 — Features 🚀 `v1.0`

> New features after stabilization.

- [ ] **Glossary management CLI** — CRUD for `glossary` table (created but unused)
- [ ] **Web UI** — view & edit translations, review workflow
- [ ] **Batch mod processing** — process a directory of mods in one run
- [ ] **Progress reporting** — progress bar for long-running operations (translation, alignment)
- [ ] **Other games support** — Skyrim SE, Starfield (parameterize xEdit family)
- [ ] **Export/import TMX** — exchange TM with other CAT tools
