# Transynth (TSN)

Node.js / TypeScript тулчейн для автоматизації локалізації ігрових модів.
Node.js / TypeScript toolchain for automating game mod localization.

## Documentation

- [doc/README.md](doc/README.md) - Project documentation wiki

## Quick start

```bash
cp .env.example .env        # vLLM за замовчуванням, або вкажіть OPENAI_API_KEY
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
