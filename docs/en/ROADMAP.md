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

- [x] **Centralized CSV parser** — extract `parseCsv()` / `csvRow()` into `src/utils/csv.ts` (RFC 4180, escaped quotes support)
- [x] **Add EDID column to `ExportTextForTranslation.pas`** — required for alignment anchors
- [x] **Multi-language export** — export all text entries for every language present in the plugin (not just one source/target pair); needed for multilang learning and alignment
- [x] **Fix `upsertMod()`** — `INSERT OR IGNORE` + SELECT, handle `undefined` row
- [x] **Fix `unmask()` ordering** — sort keys by length (longest first)
- [x] **Spawn error handling** — add `p.on('error', ...)` to `runExport.ts`

---

## Phase 2 — Docker & Dev Experience 🐳 `v0.4`

> Dockerization, unified dev environment.

- [x] **Dockerfile** — multi-stage build (Node.js + Python for native modules)
- [x] **docker-compose.yml** — services: `cli`, `dev`, optional `ollama` (GPU passthrough)
- [x] **.dockerignore** — node_modules, dist, .env, *.sqlite
- [x] **devDependencies** — move `@types/*`, `typescript`, `tsx` from dependencies
- [x] **Add `@types/node`**, `@types/better-sqlite3`

---

## Phase 3 — Reliability & Observability 🔧 `v0.5`

> Error handling, logging, retry logic.

- [x] **Error handling** — try-catch on all async operations (xEdit spawn, LLM API, file I/O)
- [x] **Use `logger.ts`** — replace `console.log` with `log.info/warn/error` across the codebase
- [x] **LLM retry + rate limiting** — retry with exponential backoff on 429/500 (for both providers)
- [x] **Batch size config** — extract `30` to CONFIG, add `BATCH_SIZE` env var
- [x] **Enable DB storage in `translateMod.ts`** — uncomment and complete `addTranslation()`
- [x] **Input validation** — verify files exist before operations
- [x] **Fallback strategy** — try primary provider, fall back to alternative if unavailable (configurable)

---

## Phase 4 — Code Quality 📐 `v0.6`

> Refactoring, tests, linting.

- [x] **Deduplicate** — PLACEHOLDER_RE, ingestCsvRows, parseCsv → shared modules
- [x] **Remove dead code** — `fileHashSha1()`, unused tables `kv_cache`
- [x] **ESLint + Prettier** — add configs and npm scripts
- [x] **Unit tests (vitest)** — `parseCsv`, `mask/unmask` round-trip, `normalizeForHash` (28 tests, 3 suites)
- [ ] **Integration tests** — translate pipeline with mock LLM provider
- [x] **Fix `ApplyTranslationsInPlace.pas`** — load CSV into map by FormID+Path instead of sequential reading

---

## Vision — Web-based ESP-ESM Translator for Fallout 4 🎯

> **Reference project: [ESP-ESM Translator (EET)](https://www.nexusmods.com/skyrimspecialedition/mods/921)** by Epervier 666.
>
> EET is a desktop Windows application (Delphi, closed-source) that translates mods for Bethesda games.
> Our goal is to build an **open-source, web-based equivalent** focused exclusively on **Fallout 4**,
> powered by **LLM + Translation Memory** instead of static databases.

### How EET works (and what we replicate)

| EET feature | Our equivalent | Phase |
|---|---|---|
| Load ESP/ESM plugin and parse all records | xEdit export → CSV (already done via `ExportTextForTranslation.pas`) | ✅ done |
| Translation Database (BDD) — vanilla + unofficial patch texts | SQLite `strings` table with TM (translation memory) from learned mods | ✅ done |
| Match by FormID + EDID + original text | `findStringId()`, alignment by FormID+Path+EDID | ✅ done |
| Custom database (user-built) | `learnFromMods` / `learnFromMultilangMod` CLI — ingest arbitrary mod pairs | ✅ done |
| OnlyText matching (text-only, ignore metadata) | Fuzzy matching via embeddings (`src/align/fuzzy.ts`, `src/llm/embed.ts`) | ✅ done |
| Auto-translate: without punctuation, without numbers | Placeholder masking (`src/utils/placeholders.ts`) | ✅ done |
| Google Translate / DeepL integration | LLM translation: Ollama (local) / OpenAI API with retry + fallback | ✅ done |
| OpenAI ChatGPT API integration | `src/llm/translate.ts` via provider abstraction | ✅ done |
| Color-coded line status (green=validated, grey=partial, white=new, turquoise=fuzzy) | Web UI: status badges + color coding per string | Phase 5 |
| Manual editing + validation (F10) | Web UI: inline editing, approve/reject per string | Phase 5 |
| Launch translation → write into plugin | `ApplyTranslationsInPlace.pas` via xEdit (already done) | ✅ done |
| Load previously translated mod (update workflow) | DB-based: previous translations auto-loaded from TM | Phase 6 |
| Compare mods / analyze directory | Batch processing + diff view | Phase 6 |
| Glossary / term consistency | `glossary` table CRUD + enforcement during translation | Phase 6 |
| Script decompilation & translation | Out of scope (Fallout 4 Papyrus scripts rarely need localization) | — |
| BSA/BA2 archive reading/writing | Out of scope (mods are extracted; xEdit handles plugin I/O) | — |
| MCM menu translation | Future: parse MCM JSON/XML configs | Phase 7 |
| FOMOD file translation | Future: parse fomod XML | Phase 7 |
| Replacement matrix (mass find-replace) | Web UI: bulk search-replace across all strings | Phase 6 |
| Export/save translation as XML | Export/import TMX for CAT tool interop | Phase 7 |

---

## Phase 5 — Web UI 🌐 `v1.0`

> Web-based translation workbench — the core of our "EET for Fallout 4" vision.

- [x] **Backend API** — Fastify REST API over existing SQLite DB (`GET /api/mods`, `GET /api/strings`, `PATCH /api/strings/:id/translation`, `POST /api/strings/translate`, etc.)
- [x] **Frontend scaffold** — React (Vite) SPA, layout: navbar + mods list + string editor table
- [x] **Strings table** — columns: FormID, Record Type, Source (EN), Translation (UK), Status; paginated, filterable
- [x] **Status color coding** — like EET: `human/approved` (green), `tm` (blue), `fuzzy` (turquoise), `auto` (orange), `untranslated` (grey)
- [x] **Inline editing** — click translation cell → textarea editor, save with Ctrl+Enter or Save button
- [x] **Approve / reject** — per-string approve button (sets status to `human`)
- [x] **Batch LLM translate** — select strings with checkboxes → send to LLM → fill with status `auto`
- [x] **Search & filter** — by text/FormID/EDID, status, record type (Signature)
- [x] **Progress dashboard** — per-mod completion stats with stacked progress bar
- [x] **Docker service** — `web` service added to docker-compose.yml (API + static frontend on port 3000)

---

## Phase 6 — Translation Memory & Workflows 🧠 `v1.1`

> Advanced TM features inspired by EET's database system.

- [x] **TM auto-apply** — on any mod, auto-match untranslated strings from TM by anchor (FormID+path) → EDID → exact text_norm; fills with status `tm` and a confidence score
- [x] **Glossary management** — Web UI CRUD for `glossary` table (`/glossary` page); glossary terms auto-injected into LLM system prompt during batch translation
- [x] **Translation propagation** — when saving a translation, automatically propagates to all other strings with the same `text_norm` that have no human-approved translation
- [x] **Bulk search-replace** — `POST /api/mods/:id/search-replace` with regex/literal support + dry-run preview; accessible from the editor toolbar (Search & Replace modal)
- [x] **SSE progress reporting** — batch LLM translate streams real-time progress via Server-Sent Events (`text/event-stream`); frontend shows live done/total counter
- [x] **Mod update diff** — `GET /api/mods/:id/diff?compareModId=` compares two versions; `/diff` page shows added/removed/changed strings with colour coding
- [ ] **Batch mod processing** — upload/import a directory of mods, process all in one session
- [ ] **Diff view in-editor** — inline diff highlighting in the translation editor when a mod is updated

---

## Phase 7 — Extended Features 🚀 `v1.2+`

> Additional formats, interoperability, community features.

- [ ] **MCM translation** — parse and translate MCM Helper JSON / config files
- [ ] **FOMOD translation** — parse and translate `fomod/info.xml` + `ModuleConfig.xml`
- [ ] **Export/import TMX** — exchange TM with external CAT tools (OmegaT, memoQ, Trados)
- [ ] **Export/import EET XML** — import/export EET-compatible XML saves for interop with the desktop tool
- [ ] **Multi-user support** — auth, per-user roles (translator, reviewer, admin)
- [ ] **Review workflow** — assign strings to reviewers, track approval chain
- [ ] **Translation comments** — per-string comments & discussion thread
- [ ] **Context preview** — show in-game context (record type, NPC speaker, quest stage) alongside strings
- [ ] **Dynamic String Distributor output** — generate DSD JSON files for runtime string injection
- [ ] **Other games support** — Skyrim SE, Starfield (parameterize xEdit family)
