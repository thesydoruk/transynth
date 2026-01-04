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

- [x] **Централізований CSV parser** — винести `parseCsv()` / `csvRow()` в `src/utils/csv.ts` (RFC 4180, підтримка escaped quotes)
- [x] **Додати EDID колонку в `ExportTextForTranslation.pas`** — потрібна для alignment anchors
- [x] **Експорт усіх текстів для всіх мов** — експортувати текстові записи для кожної мови, присутньої у плагіні (не лише одна пара source/target); потрібно для multilang learning та alignment
- [x] **Fix `upsertMod()`** — `INSERT OR IGNORE` + SELECT, обробка `undefined` row
- [x] **Fix `unmask()` ordering** — сортувати ключі за довжиною (від довших до коротших)
- [x] **Spawn error handling** — додати `p.on('error', ...)` в `runExport.ts`

---

## Phase 2 — Docker & Dev Experience 🐳 `v0.4`

> Докеризація, уніфіковане dev-середовище.

- [x] **Dockerfile** — multi-stage build (Node.js + Python для native модулів)
- [x] **docker-compose.yml** — сервіси `cli`, `dev`, опціональний `ollama` (GPU passthrough)
- [x] **.dockerignore** — node_modules, dist, .env, *.sqlite
- [x] **devDependencies** — перемістити `@types/*`, `typescript`, `tsx` з dependencies
- [x] **Додати `@types/node`**, `@types/better-sqlite3`

---

## Phase 3 — Надійність та спостережуваність 🔧 `v0.5`

> Обробка помилок, логування, retry.

- [x] **Error handling** — try-catch на всі async-операції (xEdit spawn, LLM API, file I/O)
- [x] **Використати `logger.ts`** — замінити `console.log` на `log.info/warn/error` по всьому коду
- [x] **LLM retry + rate limiting** — retry з exponential backoff при 429/500 (для обох провайдерів)
- [x] **Batch size config** — винести `30` у CONFIG, додати `BATCH_SIZE` env var
- [x] **Увімкнути збереження в DB в `translateMod.ts`** — розкоментувати та доробити `addTranslation()`
- [x] **Input validation** — перевірка існування файлів перед операціями
- [x] **Fallback стратегія** — спробувати основний провайдер, fallback на альтернативний якщо недоступний (конфігурується)

---

## Phase 4 — Якість коду 📐 `v0.6`

> Рефакторинг, тести, лінтинг.

- [x] **Deduplicate** — PLACEHOLDER_RE, ingestCsvRows, parseCsv → спільні модулі
- [x] **Видалити dead code** — `fileHashSha1()`, невикористовувані таблиці `kv_cache`
- [x] **ESLint + Prettier** — додати конфіги та npm скрипти
- [x] **Unit tests (vitest)** — `parseCsv`, `mask/unmask` round-trip, `normalizeForHash` (28 тестів, 3 сюіти)
- [ ] **Integration tests** — translate pipeline з mock LLM provider
- [x] **Fix `ApplyTranslationsInPlace.pas`** — завантажити CSV в map за FormID+Path замість послідовного читання

---

## Візія — Веб-версія ESP-ESM Translator для Fallout 4 🎯

> **Референс: [ESP-ESM Translator (EET)](https://www.nexusmods.com/skyrimspecialedition/mods/921)** від Epervier 666.
>
> EET — десктопний Windows-додаток (Delphi, closed-source) для перекладу модів Bethesda-ігор.
> Наша мета — побудувати **відкритий, веб-орієнтований аналог**, зосереджений виключно на **Fallout 4**,
> з використанням **LLM + Translation Memory** замість статичних баз даних.

### Як працює EET (і що ми відтворюємо)

| Функція EET | Наш аналог | Фаза |
|---|---|---|
| Завантажити ESP/ESM плагін, розпарсити всі записи | xEdit export → CSV (вже зроблено через `ExportTextForTranslation.pas`) | ✅ зроблено |
| База перекладів (BDD) — vanilla + unofficial patch тексти | SQLite таблиця `strings` з TM (translation memory) з вивчених модів | ✅ зроблено |
| Матч за FormID + EDID + оригінальний текст | `findStringId()`, alignment за FormID+Path+EDID | ✅ зроблено |
| Кастомна база (користувацька) | `learnFromMods` / `learnFromMultilangMod` CLI — інгест довільних пар модів | ✅ зроблено |
| OnlyText матч (лише текст, ігноруючи метадані) | Fuzzy matching через ембединги (`src/align/fuzzy.ts`, `src/llm/embed.ts`) | ✅ зроблено |
| Авто-переклад: без пунктуації, без чисел | Маскування плейсхолдерів (`src/utils/placeholders.ts`) | ✅ зроблено |
| Інтеграція Google Translate / DeepL | LLM переклад: Ollama (локально) / OpenAI API з retry + fallback | ✅ зроблено |
| Інтеграція OpenAI ChatGPT API | `src/llm/translate.ts` через абстракцію провайдера | ✅ зроблено |
| Кольорове кодування рядків (зелений=валідований, сірий=часткове, білий=новий, бірюзовий=fuzzy) | Web UI: статус-бейджі + кольорове кодування для кожного рядка | Phase 5 |
| Ручне редагування + валідація (F10) | Web UI: inline-редагування, approve/reject для кожного рядка | Phase 5 |
| Лансувати переклад → записати в плагін | `ApplyTranslationsInPlace.pas` через xEdit (вже зроблено) | ✅ зроблено |
| Завантажити попередній переклад (workflow оновлення) | На основі DB: попередні переклади авто-завантажуються з TM | Phase 6 |
| Порівняння модів / аналіз каталогу | Пакетна обробка + diff view | Phase 6 |
| Глосарій / контроль термінологічної послідовності | CRUD таблиці `glossary` + enforcement під час перекладу | Phase 6 |
| Декомпіляція та переклад скриптів | Поза скопом (Papyrus скрипти Fallout 4 рідко потребують локалізації) | — |
| Читання/запис BSA/BA2 архівів | Поза скопом (моди розпаковані; xEdit обробляє I/O плагінів) | — |
| Переклад MCM меню | Майбутнє: парсинг MCM JSON/XML конфігів | Phase 7 |
| Переклад FOMOD файлів | Майбутнє: парсинг fomod XML | Phase 7 |
| Матриця замін (масовий find-replace) | Web UI: bulk search-replace по всіх рядках | Phase 6 |
| Експорт/збереження перекладу як XML | Export/import TMX для інтеропу з CAT-інструментами | Phase 7 |

---

## Phase 5 — Web UI 🌐 `v1.0`

> Веб-воркбенч для перекладу — ядро нашої візії «EET для Fallout 4».

- [x] **Backend API** — Fastify REST API поверх існуючої SQLite DB (`GET /api/mods`, `GET /api/strings`, `PATCH /api/strings/:id/translation`, `POST /api/strings/translate`, etc.)
- [x] **Frontend scaffold** — React (Vite) SPA, layout: navbar + список модів + редактор рядків
- [x] **Таблиця рядків** — колонки: FormID, тип запису, Source (EN), Translation (UK), Status; сторінкування, фільтрація
- [x] **Кольорове кодування статусів** — як в EET: `human/approved` (зелений), `tm` (синій), `fuzzy` (бірюзовий), `auto` (жовтогарячий), `untranslated` (сірий)
- [x] **Inline-редагування** — клік по клітинці перекладу → textarea-редактор, збереження Ctrl+Enter або кнопкою
- [x] **Approve / reject** — кнопка approve для кожного рядка (статус → `human`)
- [x] **Пакетний LLM переклад** — виділити рядки чекбоксами → надіслати в LLM → заповнити зі статусом `auto`
- [x] **Пошук та фільтрація** — за текстом/FormID/EDID, статусом, типом запису (Signature)
- [x] **Дашборд прогресу** — статистика завершеності по моду зі стековим прогрес-баром
- [x] **Docker сервіс** — сервіс `web` доданий до docker-compose.yml (API + статичний фронтенд на порту 3000)

---

## Phase 6 — Translation Memory та Workflows 🧠 `v1.1`

> Просунуті TM-функції, натхненні системою баз даних EET.

- [x] **TM auto-apply** — для будь-якого моду авто-матч неперекладених рядків з TM за anchor (FormID+path) → EDID → точний text_norm; заповнює зі статусом `tm` і числом довіри (confidence)
- [x] **Управління глосарієм** — Web UI CRUD для таблиці `glossary` (сторінка `/glossary`); терміни глосарію автоматично інжектуються в системний промпт LLM під час пакетного перекладу
- [x] **Пропагація перекладу** — при збереженні перекладу автоматично поширюється на всі рядки з тим самим `text_norm`, в яких немає human-затвердженого перекладу
- [x] **Масовий пошук-заміна** — `POST /api/mods/:id/search-replace` з підтримкою regex/літерал + dry-run preview; доступний з тулбару редактора (модал Search & Replace)
- [x] **SSE progress reporting** — пакетний LLM-переклад стримить прогрес в реальному часі через Server-Sent Events (`text/event-stream`); фронтенд показує лічильник done/total
- [x] **Diff модів** — `GET /api/mods/:id/diff?compareModId=` порівнює дві версії; сторінка `/diff` показує додані/видалені/змінені рядки з кольоровим кодуванням
- [ ] **Пакетна обробка модів** — завантажити/імпортувати каталог модів, обробити всі за одну сесію
- [ ] **Diff в редакторі** — inline-підсвічування змін у редакторі при оновленні моду

---

## Phase 7 — Розширені можливості 🚀 `v1.2+`

> Додаткові формати, інтероперабельність, командна робота.

- [ ] **Переклад MCM** — парсинг та переклад MCM Helper JSON / config файлів
- [ ] **Переклад FOMOD** — парсинг та переклад `fomod/info.xml` + `ModuleConfig.xml`
- [ ] **Export/import TMX** — обмін TM із зовнішніми CAT-інструментами (OmegaT, memoQ, Trados)
- [ ] **Export/import EET XML** — імпорт/експорт EET-сумісних XML збережень для інтеропу з десктопним інструментом
- [ ] **Мультикористувацька підтримка** — авторизація, ролі (перекладач, рев'юер, адмін)
- [ ] **Review workflow** — призначення рядків рев'юерам, трекінг ланцюга затвердження
- [ ] **Коментарі до перекладу** — коментарі та дискусії на рівні рядка
- [ ] **Контекстний перегляд** — показ ігрового контексту (тип запису, NPC-спікер, стейдж квесту) поряд з рядками
- [ ] **Dynamic String Distributor output** — генерація DSD JSON файлів для runtime-інжекту рядків
- [ ] **Підтримка інших ігор** — Skyrim SE, Starfield (параметризація xEdit family)
