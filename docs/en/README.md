# Fallout 4 Localization Pipeline

> **Українська версія:** [../uk/README.md](../uk/README.md)

Node.js / TypeScript toolchain for automating Fallout 4 mod localization.

## Features

| Component | Description |
|-----------|-------------|
| **Native plugin parser** | Read and write ESP/ESM/ESL plugins, BA2 archives, and STRINGS files natively — no external tools needed |
| **LLM translation** | Batch translation via Ollama (primary) or OpenAI with placeholder masking (`%d`, `{Name}`, `<br>`) and glossary term protection |
| **Translation Memory** | SQLite + FTS5: accumulating translations with statuses `human > tm > fuzzy > auto` |
| **TM learning** | Learning from pairs (original ↔ translated) and from multi-lingual mods with locale auto-detection |
| **Alignment** | Multi-pass matching: EDID → hash → path → RapidFuzz → LLM embeddings |

## Architecture

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

## Requirements

- **Node.js** ≥ 18 (20 LTS recommended)
- **Python** ≥ 3.10 (for `better-sqlite3` native addon compilation)
- **Ollama** — local LLM server (primary translation backend), `http://localhost:11434`
- **Docker** (optional) — for unified dev environment without manual Python installation

## Quick start

### Option A: Docker (recommended)

```bash
docker compose run --rm cli npm run db:init
docker compose run --rm cli npm run translate -- --in data/strings.en.csv --out data/strings.uk.csv
```

### Option B: Local

```bash
cp .env.example .env        # Ollama by default, or set OPENAI_API_KEY
npm install
npm run db:init              # create SQLite schema
```

## Usage

### 1. Learn TM from a mod pair (original + translation)

```bash
npm run learn:pairs -- \
  --pair "D:\mods\Orig.esp:D:\mods\Uk.esp" \
  --srcLang en --tgtLang uk
```

### 2. Learn TM from a multi-lingual mod

```bash
npm run learn:multilang -- \
  --mod "D:\mods\BigQuest.esp" \
  --extraLocales uk,zh
```

### 3. Translate CSV

```bash
npm run translate -- \
  --in work/strings.en.csv \
  --out work/strings.uk.csv \
  --srcLang en --tgtLang uk \
  --style configs/style.uk.md \
  --glossary configs/glossary_base.uk.txt
```

### 4. Full replace flow (copy → export → translate → apply)

```bash
npm run replace -- \
  --mod "D:\mods\MyMod.esp" \
  --outDir "D:\out" \
  --style configs/style.uk.md \
  --glossary configs/glossary_base.uk.txt
```

## Configuration

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `ollama` | LLM provider: `ollama` or `openai` |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | — | Model for Ollama (e.g., `llama3`, `mistral`, `gemma2`) |
| `OPENAI_API_KEY` | — | OpenAI API key (required if `LLM_PROVIDER=openai`) |
| `OPENAI_TRANSLATE_MODEL` | `gpt-4.1-mini` | OpenAI translation model |
| `OPENAI_EMBED_MODEL` | `text-embedding-3-large` | OpenAI embedding model (for alignment) |
| `DATABASE_PATH` | `./localizer.sqlite` | Path to SQLite database |
| `DEBUG` | — | Any value enables debug logs |

### npm scripts

| Script | Description |
|--------|-------------|
| `db:init` | Create / update SQLite schema |
| `build` | Compile TypeScript → `dist/` |
| `learn:pairs` | Learn TM from original + translated pair |
| `learn:multilang` | Learn TM from a multi-lingual mod |
| `translate` | Translate CSV via LLM (Ollama / OpenAI) |
| `replace` | Full pipeline: read → translate → write patched plugin |

## Project structure

```
├── docs/
│   ├── uk/                   # Документація українською
│   │   ├── README.md
│   │   └── ROADMAP.md
│   └── en/                   # Documentation in English
│       ├── README.md             ← you are here
│       └── ROADMAP.md
├── src/
│   ├── cli/                  # CLI entry-points
│   │   ├── learnFromMods.ts
│   │   ├── learnFromMultilangMod.ts
│   │   ├── translateMod.ts
│   │   └── replaceFlow.ts
│   ├── bethesda/             # Native Bethesda format parsers
│   │   ├── espReader.ts
│   │   ├── espWriter.ts
│   │   ├── ba2Reader.ts
│   │   ├── stringsFile.ts
│   │   └── knownStrings.ts
│   ├── llm/                  # LLM providers (Ollama, OpenAI)
│   │   ├── client.ts
│   │   ├── translate.ts
│   │   └── embed.ts
│   ├── align/                # Alignment algorithms
│   │   ├── alignPairs.ts
│   │   └── fuzzy.ts
│   ├── utils/                # Utilities
│   │   ├── file.ts
│   │   ├── hash.ts
│   │   ├── placeholders.ts
│   │   └── textNorm.ts
│   ├── config.ts
│   ├── db.ts
│   ├── logger.ts
│   └── types.ts
├── scripts/                  # Helper scripts
├── sql/                      # SQLite schema
└── bin/                      # Shell/bat wrappers
```

## Database

SQLite with WAL mode and FTS5. Tables:

| Table | Purpose |
|-------|---------|
| `mods` | Mod registry (name, path, version hash) |
| `records` | Plugin records (FormID, Signature, Path, EDID) |
| `strings` | Text strings bound to record + language |
| `translations` | Translations with priority: human → tm → fuzzy → auto |
| `alignments` | Alignment results between strings |
| `glossary` | Term dictionary |
| `strings_fts` | FTS5 full-text index on strings |

## Alignment algorithm

```
Pass 1: Hash anchor       — identical normalized-hash → exact match (score 1.0)
Pass 2: EDID + Signature  — unique EDID within signature → match (score 1.0)
Pass 3: Path + Signature  — path_simplified within signature → match (score 1.0)
Pass 4: RapidFuzz          — fuzzy ratio ≥ 90 within signature → strong match
Pass 5: Embeddings (opt)   — cosine similarity for ambiguous fuzzy (≥ 85) candidates
```

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the detailed development plan.

## License

Private project.
