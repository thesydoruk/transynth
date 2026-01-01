# Дорожня карта

> **English version:** [../en/ROADMAP.md](../en/ROADMAP.md)

---

## Phase 0 — LLM Provider, Ollama & критичні виправлення ⚡🦙 `v0.2`

> Абстракція провайдера, інтеграція Ollama (основний бекенд), виправлення критичних багів.

- [x] **Абстракція провайдера** — `src/llm/provider.ts` з єдиним інтерфейсом `LLMProvider` (методи `chat`, `embed`); бекенди `ollama` | `openai`
- [x] **Ollama provider** — OpenAI-сумісний клієнт на `http://localhost:11434/v1` через OpenAI SDK з кастомним `baseURL`
- [x] **Конфіг: `LLM_PROVIDER`** — env var для вибору провайдера (`ollama` | `openai`, **за замовчуванням: `ollama`**)
- [x] **Конфіг: `OLLAMA_BASE_URL`** — за замовчуванням `http://localhost:11434`
- [x] **Конфіг: `OLLAMA_MODEL`** — назва моделі для Ollama (наприклад, `llama3`, `mistral`, `gemma2`)
- [x] **Конфіг: `OPENAI_TRANSLATE_MODEL`** — за замовчуванням `gpt-4.1-mini` (було `gpt-5.1-mini`)
- [x] **Fix translate pipeline** — переписати `src/openai/translate.ts` → `src/llm/translate.ts` використовуючи `LLMProvider.chat()` (виправляє зламаний `openai.responses.create()`)
- [x] **Підтримка ембедингів** — `LLMProvider.embed()` — локальні ембединги через Ollama, OpenAI `text-embedding-3-large` як альтернатива
- [x] **Валідація конфігу** — fail-fast при старті: перевірка `OPENAI_API_KEY` (якщо provider=openai), доступність Ollama (якщо provider=ollama)
- [x] **Fix `require()` in ESM** — `src/utils/file.ts` — замінити `require('crypto')` на `import crypto`
- [x] **Створити `.env.example`** — з усіма LLM-змінними, `DATABASE_PATH`, etc.

---

## Phase 1 — Цілісність даних 🛡️ `v0.3`

> Надійний CSV pipeline, коректна робота з даними.

- [ ] **Централізований CSV parser** — винести `parseCsv()` / `csvRow()` в `src/utils/csv.ts` (RFC 4180, підтримка escaped quotes)
- [ ] **Додати EDID колонку в `ExportTextForTranslation.pas`** — потрібна для alignment anchors
- [ ] **Fix `upsertMod()`** — `INSERT OR IGNORE` + SELECT, обробка `undefined` row
- [ ] **Fix `unmask()` ordering** — сортувати ключі за довжиною (від довших до коротших)
- [ ] **Spawn error handling** — додати `p.on('error', ...)` в `runExport.ts`

---

## Phase 2 — Docker & Dev Experience 🐳 `v0.4`

> Докеризація, уніфіковане dev-середовище.

- [ ] **Dockerfile** — multi-stage build (Node.js + Python для native модулів)
- [ ] **docker-compose.yml** — сервіси `cli`, `dev`, опціональний `ollama` (GPU passthrough)
- [ ] **.dockerignore** — node_modules, dist, .env, *.sqlite
- [ ] **devDependencies** — перемістити `@types/*`, `typescript`, `tsx` з dependencies
- [ ] **Додати `@types/node`**, `@types/better-sqlite3`

---

## Phase 3 — Надійність та спостережуваність 🔧 `v0.5`

> Обробка помилок, логування, retry.

- [ ] **Error handling** — try-catch на всі async-операції (xEdit spawn, LLM API, file I/O)
- [ ] **Використати `logger.ts`** — замінити `console.log` на `log.info/warn/error` по всьому коду
- [ ] **LLM retry + rate limiting** — retry з exponential backoff при 429/500 (для обох провайдерів)
- [ ] **Batch size config** — винести `30` у CONFIG, додати `BATCH_SIZE` env var
- [ ] **Увімкнути збереження в DB в `translateMod.ts`** — розкоментувати та доробити `addTranslation()`
- [ ] **Input validation** — перевірка існування файлів перед операціями
- [ ] **Fallback стратегія** — спробувати основний провайдер, fallback на альтернативний якщо недоступний (конфігурується)

---

## Phase 4 — Якість коду 📐 `v0.6`

> Рефакторинг, тести, лінтинг.

- [ ] **Deduplicate** — PLACEHOLDER_RE, ingestCsvRows, parseCsv → спільні модулі
- [ ] **Видалити dead code** — `fileHashSha1()`, невикористані таблиці `kv_cache`
- [ ] **ESLint + Prettier** — додати конфіги та npm скрипти
- [ ] **Unit tests (vitest)** — `parseCsv`, `mask/unmask` round-trip, `alignPairs`, `normalizeForHash`
- [ ] **Integration tests** — translate pipeline з mock LLM provider
- [ ] **Fix `ApplyTranslationsInPlace.pas`** — завантажувати CSV в map за FormID+Path замість послідовного читання

---

## Phase 5 — Нові можливості 🚀 `v1.0`

> Нова функціональність після стабілізації.

- [ ] **Glossary management CLI** — CRUD для `glossary` таблиці (зараз створена, але не використовується)
- [ ] **Web UI** — перегляд / редагування перекладів, review workflow
- [ ] **Batch mod processing** — обробка каталогу модів одним запуском
- [ ] **Progress reporting** — progress bar для довгих операцій (translation, alignment)
- [ ] **Підтримка інших ігор** — Skyrim SE, Starfield (параметризація xEdit family)
- [ ] **Export/import TMX** — обмін TM з іншими CAT-інструментами
