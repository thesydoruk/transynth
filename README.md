# Fallout 4 Localization Pipeline

Node.js / TypeScript тулчейн для автоматичної локалізації модів Fallout 4.
Node.js / TypeScript toolchain for automating Fallout 4 mod localization.

## Документація / Documentation

| 🇺🇦 Українська (основна) | 🇬🇧 English |
|---|---|
| [docs/uk/README.md](docs/uk/README.md) | [docs/en/README.md](docs/en/README.md) |

## Quick start

```bash
cp .env.example .env        # Ollama за замовчуванням, або вкажіть OPENAI_API_KEY
npm install
npm run db:init
```

Or with Docker:

```bash
docker compose run --rm cli npm run db:init
docker compose run --rm cli npm run translate -- --in data/strings.en.csv --out data/strings.uk.csv
```

## Ліцензія / License

Private project.

