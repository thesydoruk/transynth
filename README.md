# storywealth-localizer-node

Node.js/TypeScript toolchain for automating Fallout 4 mod localization:
- xEdit (FO4Edit) headless export/import
- Translation via OpenAI with placeholder/glossary protection
- TM learning from existing mods (including multi-lingual mods)
- SQLite with FTS5 to store strings and translations
- Optional fuzzy + embeddings based alignment for version mismatches

## Quick start
1. `cp .env.example .env` and set `OPENAI_API_KEY`.
2. `npm i`
3. `npm run db:init` → creates SQLite schema at `DATABASE_PATH` (default `./localizer.sqlite`)
4. Put xEdit scripts in `./xedit` (already included here).
5. Try learning from a pair:
   ```bash
   npm run learn:pairs -- --xedit "D:\Tools\FO4Edit\FO4Edit.exe" --exporter "./xedit/ExportTextForTranslation.pas" --pair "D:\mods\Orig.esp:D:\mods\Uk.esp" --srcLang en --tgtLang uk
   ```
6. Translate an exported CSV:
   ```bash
   npm run translate -- --in work/_work/strings.en.csv --out work/_work/strings.uk.csv --srcLang en --tgtLang uk --style configs/style.uk.md --glossary configs/glossary_base.uk.txt
   ```
7. Full replace flow (copy → export → translate → apply):
   ```bash
   npm run replace -- --xedit "D:\Tools\FO4Edit\FO4Edit.exe" --exporter "./xedit/ExportTextForTranslation.pas" --applier "./xedit/ApplyTranslationsInPlace.pas" --mod "D:\mods\MyMod.esp" --outDir "D:\out" --style configs/style.uk.md --glossary configs/glossary_base.uk.txt
   ```

### Environment variables
```env
OPENAI_API_KEY=...
OPENAI_TRANSLATE_MODEL=gpt-5.1-mini
OPENAI_EMBED_MODEL=text-embedding-3-large
DATABASE_PATH=./localizer.sqlite
```

### npm scripts
- `db:init` → create database schema  
- `learn:pairs` → learn from pair original+translated mods  
- `learn:multilang` → learn from one multilingual mod  
- `translate` → translate exported CSV  
- `replace` → full replace pipeline  

### Notes
- Translations are stored in SQLite with priority: `human > tm > fuzzy > auto`.
- Replace flow always copies the original plugin into `outDir` before editing.
- Multilingual mods are supported with `learn:multilang`.
- Alignment of different versions uses anchors (EDID, Signature, path_simplified, hash_norm) then fuzzy and embeddings.
