# Fallout 4 Localization Pipeline

Node.js / TypeScript тулчейн для автоматичної локалізації модів Fallout 4.

> **English version:** [../en/README.md](../en/README.md)

## Можливості

| Компонент | Опис |
|-----------|------|
| **Нативний парсер плагінів** | Читання та запис ESP/ESM/ESL плагінів, BA2-архівів та STRINGS-файлів нативно — без зовнішніх інструментів |
| **LLM translation** | Переклад батчами через Ollama (основний) або OpenAI з маскуванням placeholder'ів (`%d`, `{Name}`, `<br>`) та glossary-термінів |
| **Translation Memory** | SQLite + FTS5: накопичення перекладів зі статусами `human > tm > fuzzy > auto` |
| **TM learning** | Навчання з пар (оригінал ↔ переклад) та з мультимовних модів з автодетектом локалей |
| **Alignment** | Багаторівневий матчинг: EDID → hash → path → RapidFuzz → LLM embeddings |

## Архітектура

```
┌────────────────────────────────────────────────────────┐
│  CLI commands (src/cli/)                               │
│  ┌──────────┐ ┌──────────────┐ ┌──────────────────┐   │
│  │translate  │ │learnFromMods │ │learnFromMultilang│   │
│  │Mod.ts    │ │.ts           │ │Mod.ts            │   │
│  └────┬─────┘ └──────┬───────┘ └────────┬─────────┘   │
│       │              │                  │              │
│  ┌────▼──────────────▼──────────────────▼───────────┐  │
│  │  Core modules                                    │  │
│  │  llm/  align/  utils/  bethesda/  db.ts  config  │  │
│  └────┬─────────────────────────────────────────────┘  │
└───────┼────────────────────────────────────────────────┘
        │
   ┌────▼────┐
   │ SQLite  │
   │ (local) │
   └─────────┘
```

## Вимоги

- **Node.js** ≥ 18 (рекомендується 20 LTS)
- **Python** ≥ 3.10 (для компіляції `better-sqlite3` native addon)
- **Ollama** — локальний LLM-сервер (основний бекенд перекладу), `http://localhost:11434`
- **Docker** (опціонально) — для уніфікованого dev-середовища без ручного встановлення Python

## Quick start

### Варіант A: Docker (рекомендовано)

```bash
docker compose run --rm cli npm run db:init
docker compose run --rm cli npm run translate -- --in data/strings.en.csv --out data/strings.uk.csv
```

### Варіант B: Локально

```bash
cp .env.example .env        # за замовчуванням Ollama, або вказати OPENAI_API_KEY
npm install
npm run db:init              # створити SQLite-схему
```

## Використання

### 1. Навчання TM з пари модів (оригінал + переклад)

```bash
npm run learn:pairs -- \
  --pair "D:\mods\Orig.esp:D:\mods\Uk.esp" \
  --srcLang en --tgtLang uk
```

### 2. Навчання TM з мультимовного моду

```bash
npm run learn:multilang -- \
  --mod "D:\mods\BigQuest.esp" \
  --extraLocales uk,zh
```

### 3. Переклад CSV

```bash
npm run translate -- \
  --in work/strings.en.csv \
  --out work/strings.uk.csv \
  --srcLang en --tgtLang uk \
  --style configs/style.uk.md \
  --glossary configs/glossary_base.uk.txt
```

### 4. Повний replace flow (copy → export → translate → apply)

```bash
npm run replace -- \
  --mod "D:\mods\MyMod.esp" \
  --outDir "D:\out" \
  --style configs/style.uk.md \
  --glossary configs/glossary_base.uk.txt
```

## Конфігурація

### Змінні оточення

| Змінна | За замовчуванням | Опис |
|--------|-----------------|------|
| `LLM_PROVIDER` | `ollama` | Провайдер LLM: `ollama` або `openai` |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | URL Ollama сервера |
| `OLLAMA_MODEL` | — | Модель для Ollama (напр. `llama3`, `mistral`, `gemma2`) |
| `OPENAI_API_KEY` | — | Ключ OpenAI API (обов'язковий якщо `LLM_PROVIDER=openai`) |
| `OPENAI_TRANSLATE_MODEL` | `gpt-4.1-mini` | Модель OpenAI для перекладу |
| `OPENAI_EMBED_MODEL` | `text-embedding-3-large` | Модель OpenAI для ембедингів (alignment) |
| `DATABASE_PATH` | `./localizer.sqlite` | Шлях до SQLite бази |
| `DEBUG` | — | Будь-яке значення вмикає debug-логи |

### npm scripts

| Скрипт | Опис |
|--------|------|
| `db:init` | Створити / оновити SQLite-схему |
| `build` | Компіляція TypeScript → `dist/` |
| `learn:pairs` | Навчання TM з пари оригінал + переклад |
| `learn:multilang` | Навчання TM з мультимовного моду |
| `translate` | Переклад CSV через LLM (Ollama / OpenAI) |
| `replace` | Повний pipeline: зчитування → переклад → запис патченого плагіна |

## Структура проекту

```
├── docs/
│   ├── uk/                   # Документація українською
│   │   ├── README.md             ← ви тут
│   │   └── ROADMAP.md
│   └── en/                   # Documentation in English
│       ├── README.md
│       └── ROADMAP.md
├── src/
│   ├── cli/                  # CLI entry-points
│   ├── bethesda/             # Нативні парсери форматів Bethesda
│   ├── llm/                  # LLM провайдери (Ollama, OpenAI)
│   ├── align/                # Алгоритми вирівнювання
│   ├── utils/                # Допоміжні утиліти
│   ├── config.ts             # конфігурація з .env
│   ├── db.ts                 # SQLite operations
│   ├── logger.ts             # логер
│   └── types.ts              # типи
├── scripts/                  # Допоміжні скрипти
├── sql/                      # SQLite schema (DDL)
├── bin/                      # Shell/bat обгортки
└── package.json
```

## База даних

SQLite з WAL-режимом і FTS5. Таблиці:

| Таблиця | Призначення |
|---------|-------------|
| `mods` | Реєстр модів (ім'я, шлях, version hash) |
| `records` | Записи плагіна (FormID, Signature, Path, EDID) |
| `strings` | Рядки тексту з прив'язкою до record + мова |
| `translations` | Переклади з пріоритетом: human → tm → fuzzy → auto |
| `alignments` | Результати вирівнювання між рядками |
| `glossary` | Словник термінів |
| `strings_fts` | FTS5 повнотекстовий індекс по strings |

## Алгоритм вирівнювання (alignment)

```
Pass 1: Hash anchor       — ідентичний normalized-hash → exact match (score 1.0)
Pass 2: EDID + Signature  — унікальний EDID в межах сигнатури → match (score 1.0)
Pass 3: Path + Signature  — path_simplified у межах сигнатури → match (score 1.0)
Pass 4: RapidFuzz          — fuzzy ratio ≥ 90 у межах сигнатури → strong match
Pass 5: Embeddings (opt)   — cosine similarity для ambiguous fuzzy (≥ 85) candidates
```

## Дорожня карта

Детальний план розвитку — у [ROADMAP.md](ROADMAP.md).

| Фаза | Версія | Фокус |
|---|---|---|
| Phase 0 | `v0.2` | Critical Fixes ⚡ — OpenAI API, ESM, .env |
| Phase 1 | `v0.3` | Data Integrity 🛡️ — CSV parser, Pascal-скрипти, DB |
| Phase 2 | `v0.4` | Docker & DX 🐳 — Dockerfile, compose, devDeps |
| Phase 3 | `v0.5` | Reliability 🔧 — error handling, retry, logging |
| Phase 4 | `v0.6` | Code Quality 📐 — dedup, ESLint, tests |
| Phase 5 | `v0.7` | Ollama & Local LLM 🦙 — локальний інференс |
| Phase 6 | `v1.0` | Features 🚀 — glossary CLI, Web UI, TMX |

## Ліцензія

Private project.
