# Roadmap

> **Українська версія:** [../uk/ROADMAP.md](../uk/ROADMAP.md)
>
> Open-source, web-based localization tool for Fallout 4 mods.
> LLM-powered translation (Ollama / OpenAI) + Translation Memory + multi-pass alignment.
> Inspired by [ESP-ESM Translator](https://www.nexusmods.com/skyrimspecialedition/mods/921) — but open, web-native, and AI-driven.

---

## What's already built ✅

The foundation and core features are fully functional:

| Area | What works |
|------|-----------|
| **Plugin I/O** | Native ESP/ESM/ESL + BA2 + STRINGS parser: extract all translatable strings, apply translations back into plugin; works on any OS with no external dependencies |
| **LLM translation** | Ollama (local, free) and OpenAI providers; placeholder & glossary masking; batch processing; exponential-backoff retry; auto-fallback between providers |
| **Translation Memory** | Learn TM from mod pairs (original + translated) or multilingual mods (auto-detect up to 8 locales, collapse clones); 5-pass alignment: hash → EDID → path → fuzzy → embeddings |
| **TM auto-apply** | Fill untranslated strings from TM by anchor (FormID+Path), EDID, or normalized text match — with confidence scores |
| **Web UI** | React SPA + Fastify API: string table with inline editing, status color coding, batch LLM translate (SSE progress), search & filter, approve/reject, progress dashboard |
| **Glossary** | CRUD glossary terms; auto-injected into LLM prompt during translation |
| **Translation propagation** | Save a translation → auto-fills all identical source strings across the mod |
| **Search & replace** | Regex/literal bulk find & replace with dry-run preview |
| **Mod diff** | Compare two mod versions: added / removed / changed strings |
| **Infrastructure** | Docker (multi-stage build, cli/dev/web services), ESLint + Prettier, structured logging, TypeScript strict mode |

---

## Milestone 1 — Translation Storage & Management System 🗄️ `v1.0`

> A complete system for persisting, tracking, and managing translations: database schema, states, versioning, API.

- [ ] **Database schema** — design and migrations: tables for translation strings, statuses, notes; foreign keys, indexes on `formId`, `edid`, `path`, `status`
- [ ] **Translation state machine** — states: `untranslated → in_progress → translated → reviewed → rejected`; bulk status transitions via Web UI and CLI
- [ ] **Translation versioning** — store every revision of a string (previous text, timestamp, optional author); view and roll back to a previous version
- [ ] **Translation REST API** — full CRUD for translation strings; batch update; filter by `status`, `modId`, `signature`, `formId`, free text
- [ ] **Export / import** — CLI `db:export` (dump all translations as JSON / CSV); `db:import` for restore or merge with existing database
- [ ] **Translator notes** — note/comment field per string; displayed in Web UI editor

---

## Milestone 2 — Stabilization 🛡️ `v1.1`

> Production-ready release: tests, edge cases, documentation.

- [ ] **Unit tests** — vitest: `parseCsv`, `mask/unmask` round-trip, `alignPairs`, `normalizeForHash`, `ingestCsvRows`
- [ ] **Integration tests** — full translate pipeline with mock LLM provider; TM learn + auto-apply cycle; search-replace transactions
- [ ] **E2E test** — export → translate → apply round-trip on a real small mod
- [ ] **Edge-case handling** — empty plugins, mods with no STRINGS, CSV with only headers, Unicode edge cases (CJK, RTL)
- [ ] **User documentation** — setup guide (Windows / Docker), step-by-step "translate your first mod" tutorial
- [ ] **Error UX** — meaningful error messages in Web UI (LLM unavailable, mod import failed, unsupported plugin format)

---

## Milestone 3 — Native Plugin Parser 🔧 `v1.2`

> Read and write ESP/ESM/BA2/STRINGS natively. Fully autonomous operation on any OS.

- [x] **STRINGS reader** — parse `.STRINGS` / `.DLSTRINGS` / `.ILSTRINGS` files (binary format: `count(u32) + dataSize(u32) + entries[{id:u32, offset:u32}] + textBlob`)
- [x] **STRINGS writer** — generate new STRINGS files with translated text
- [x] **BA2 reader** — unpack Bethesda Archive 2 (GNRL type), zlib decompression of individual files; extract STRINGS from BA2
- [x] **ESP/ESM reader** — parse binary format: `TES4 → GRUP → Record → Subrecord`; extract translatable subrecords with context (FormID, EDID, Signature, Path); handle zlib-compressed records; localized vs embedded strings
- [x] **ESP/ESM writer** — modify subrecords with translations, recalculate record sizes, preserve compressed records
- [x] **CLI import** — `src/cli/importMod.ts`: native mod import
- [x] **Unit tests** — round-trip STRINGS read→write, BA2 extraction, ESP record parsing on test mod

---

## Milestone 4 — Batch & Import Workflow 📦 `v1.3`

> Process multiple mods, import existing translations, drag-and-drop.

- [ ] **Batch mod import** — upload / scan a directory of ESPs, register all in DB, show in mod list
- [ ] **Drag-and-drop mod upload** — drop ESP/ESM file onto Web UI → auto-import → ready to translate
- [ ] **Import existing translation** — load a pre-translated ESP as target, align against original, populate TM
- [ ] **Mod update workflow** — re-import updated mod, auto-match previously translated strings, highlight new/changed (diff in editor)
- [ ] **Export translated plugin** — one-click "Build" button in Web UI: apply translations → download localized ESP
- [ ] **Progress bar for CLI pipelines** — real-time progress for long-running learn/translate operations

---

## Milestone 5 — MCM & FOMOD Translation 📋 `v1.4`

> Translate mod configuration files — not just plugin strings.

- [ ] **MCM Helper JSON** — parse MCM `config.json`, extract translatable strings, translate, write back; display in Web UI as a separate tab per mod
- [ ] **MCM INI-based settings** — parse `*_TRANSLATE.txt` files used by older MCM mods
- [ ] **FOMOD metadata** — parse `fomod/info.xml` (mod name, description) + `ModuleConfig.xml` (install wizard steps, option names, descriptions); translate and export
- [ ] **Merged view** — show MCM + FOMOD + plugin strings together per mod, with separate progress bars

---

## Milestone 6 — Interoperability 🔄 `v1.5`

> Exchange translations with other tools and communities.

- [ ] **Export TMX** — export Translation Memory as TMX 1.4b for use in OmegaT, memoQ, Trados, Crowdin
- [ ] **Import TMX** — load TMX files into TM, merge with existing translations
- [ ] **EET XML import** — import translations from ESP-ESM Translator XML save files (community has existing databases)
- [ ] **EET XML export** — export in EET-compatible format so desktop users can consume our TM
- [ ] **xTranslator SST import** — support SST (SkyrimSE Translator) dictionary files
- [ ] **Plain strings export** — export source/target pairs as TSV/PO/XLIFF for external CAT workflows

---

## Milestone 7 — Context & Quality 🎯 `v1.6`

> Help translators make better decisions.

- [ ] **Context panel** — show record type (DIAL, QUST, NPC_, BOOK, NOTE, MESG, PERK…), NPC speaker, quest name, quest stage alongside each string
- [ ] **Translation comments** — per-string comment thread for translators to discuss ambiguities
- [ ] **Glossary enforcement** — warn when a translated string uses a term inconsistently with the glossary
- [ ] **Length/placeholder validation** — warn if translation is significantly longer/shorter than source, or if placeholders were dropped or duplicated
- [ ] **Translation diff in-editor** — when a mod is updated, highlight what changed in source side-by-side with the old translation
- [ ] **Dynamic String Distributor output** — generate DSD JSON/XML for runtime string injection without modifying the original ESP (non-destructive localization)

---

## Milestone 8 — Team & Community 👥 `v2.0`

> Multi-user translation with review workflow.

- [ ] **User auth** — login/registration, session management
- [ ] **Roles** — translator, reviewer, admin; per-mod access control
- [ ] **Review workflow** — submit for review → approve / request changes → publish; status tracking
- [ ] **Assignment** — assign translation blocks (by Signature, by FormID range) to specific translators
- [ ] **Activity log** — who translated what, when; diff per edit
- [ ] **Notifications** — email/webhook when review is requested or approved

---

## Milestone 9 — Other Games & Scalability 🌍 `v3.0`

> Beyond Fallout 4.

- [ ] **Skyrim SE / AE support** — adapt parser to Skyrim record structures, test with Skyrim plugins
- [ ] **Starfield support** — SFEdit-compatible record structures, adapt parser
- [ ] **Oblivion / Fallout 3 / NV** — community demand-driven
- [ ] **PostgreSQL backend** — optional migration from SQLite for large-scale community deployments
- [ ] **Plugin API** — extension points for custom LLM providers, custom file formats, custom alignment strategies

---

## Comparison with ESP-ESM Translator

| Feature | ESP-ESM Translator | This project |
|---|---|---|
| Platform | Windows desktop (Delphi) | Web (any OS, browser) |
| Source code | Closed | Open-source |
| Load ESP/ESM/ESL | Native parser | Native parser (built-in) |
| Translation engine | Google Translate, DeepL, ChatGPT | Ollama (local, free), OpenAI (cloud); pluggable providers |
| Translation Memory | BDD files, per-game static databases | SQLite TM, learned from any mod pair, auto-aligned |
| Matching algorithm | FormID, EDID, text match | 5-pass: hash → EDID → path → fuzzy (fuzzball) → embeddings |
| TM auto-apply | Yes (database lookup) | Yes (anchor + EDID + text_norm, with confidence) |
| Glossary | Yes | Yes (DB + Web UI CRUD + auto-inject into LLM prompt) |
| Mass search-replace | Yes (replacement matrix) | Yes (regex/literal, dry-run, Web UI) |
| Mod version diff | No | Yes (added/removed/changed strings) |
| MCM/FOMOD translation | Yes | Planned (Milestone 5) |
| TMX export | No | Planned (Milestone 6) |
| Multi-user review | No | Planned (Milestone 8) |
| Translation propagation | No | Yes (auto-fills identical strings) |
| SSE live progress | No | Yes (Server-Sent Events) |
| BSA/BA2 reading | Yes | Yes (native BA2 reader) |
| Script decompilation | Yes (partial) | Out of scope |
