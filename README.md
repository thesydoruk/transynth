# Transynth

Self-hosted toolchain for **localizing game mods**: import a plugin or archive, reuse translation memory, batch-translate with a local vLLM (or OpenAI), review in the browser, then export files players can install.

It is **open** (MIT). You run it on your machine; there is no cloud account. Anyone who can reach the HTTP port can use the app — see [SECURITY.md](SECURITY.md).

The same pipeline — import, TM, LLM, review, QA, **voice**, export — runs off a **game plugin**. Bethesda and Disco Elysium are wired up today. Another title is a plugin directory, not a new product: no shared code branches on which game it is.

Voice lives in the same editor as the strings: speakers, reference audio, Fish Speech, and (for Bethesda) lip-sync tools. Localized takes export with the rest of the pack.

First-class LLM prompts and glossaries are **Ukrainian** (`en → uk`). Other targets get a generic English prompt. The UI defaults to Ukrainian.

## Games

Fallout 4, 76, 3, New Vegas · Oblivion · Morrowind · Skyrim SE / LE · Disco Elysium Final Cut.

A new game is one directory under `src/games/` implementing the plugin contract, plus one line registering it — see [Adding a Game](doc/eng/17-adding-a-game.md).

## What you get

- **Import** — ESP/ESM/ESL, BA2/BSA, zip/7z/rar, Disco langpacks. MCM, Interface, and PEX text when they are in the tree.
- **Translation memory** — exact and anchor reuse, then human review.
- **LLM** — local vLLM / Gemma, or OpenAI. Glossary in the prompt; placeholders stay intact.
- **Editor** — string grid, dialogs, voice, QA, coherence, diff when the mod updates.
- **Voice** — synthesize replicas from the translations you already reviewed.
- **Export** — STRINGS, patched ESP, BA2/BSA, Disco langpacks, ZIP.

One operator. No accounts and no login.

## 10-minute start (Docker)

You need Docker Desktop and (for AI) a vLLM or OpenAI endpoint.

Every release is published as a ready-made image on GHCR, so nothing has to be built:

```bash
git clone --branch v0.7.0 https://github.com/thesydoruk/transynth.git
cd transynth
cp .env.example .env
# Optional: set VLLM_MODEL / OPENAI_API_KEY
echo "TRANSYNTH_IMAGE=ghcr.io/thesydoruk/transynth" >> .env
echo "IMAGE_TAG=0.7.0" >> .env
docker compose pull
docker compose up -d
docker compose run --rm web npm run db:init
```

Open [http://localhost:3000](http://localhost:3000). You land on the **Games** catalogue. Pick a title, then import a mod.

Keep `IMAGE_TAG` and the checked-out tag on the same version — the Compose files and the image belong together. To upgrade, check out the new tag, change `IMAGE_TAG`, then `docker compose pull`, `docker compose up -d` and `docker compose run --rm web npm run db:init` again. Images:

- `ghcr.io/thesydoruk/transynth` — web, worker and CLI.
- `ghcr.io/thesydoruk/transynth-bethesda-tools` — the FaceFX / xWMA sidecar. With the `embedded-bethesda-tools` profile, also set `BETHESDA_TOOLS_IMAGE=ghcr.io/thesydoruk/transynth-bethesda-tools:0.7.0`, or `docker compose pull` stops at its local-only default name.

Tags: `0.7.0` (a release), `0.7` (newest patch of that release), `latest` (tip of `main`, not a release).

To build from source instead, skip the two `echo` lines and run `docker compose up -d --build`.

`.env.example` starts embedded Postgres (`COMPOSE_PROFILES=embedded-db`). Add `embedded-vllm`, `embedded-embed`, `embedded-audio-intel`, and/or `embedded-bethesda-tools` for in-stack Gemma / Arctic embed / Whisper / FaceFX+xWMA. Production with external Postgres / vLLM / Whisper / tools: omit those profiles and start `web worker redis`. Details: [Getting Started](doc/eng/01-getting-started.md).

Local Node (API + worker + Vite, Postgres/Redis you provide):

```bash
cp .env.example .env
npm install
npm --prefix web-ui install
npm run db:init
npm run dev
```

UI: [http://localhost:5173](http://localhost:5173).

## What it is not

A multi-user SaaS. A language-neutral TM platform. A replacement for owning the games and (for lip-sync) the Creation Kit.

## Known limitations

- One operator, no accounts. Anyone who can reach the HTTP port can use the app.
- Default bind is localhost. Docker Compose publishes `WEB_PORT` on the host interfaces Docker binds.
- First-class LLM prompts and glossaries are Ukrainian. Other targets get a generic English prompt.
- Production Postgres is external unless you enable the `embedded-db` Compose profile.
- Importing a mod that ships several per-language voice BA2/BSA archives with the same internal paths keeps only the last extracted archive. Synthesized output is written under `_localize_{hash}/{lang}/` and is not affected.
- EET and CSV import are migration paths under **Advanced import**, not the main plugin/archive flow.

## Docs

- [Wiki](doc/README.md) — [English](doc/eng/README.md) · [Українська](doc/uk/README.md)
- [CHANGELOG.md](doc/CHANGELOG.md)
- [SECURITY.md](SECURITY.md) — bind address, trusted LAN, uploads, Redis
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [THIRD_PARTY.md](doc/THIRD_PARTY.md) — Champollion, FaceFX, Fonix, GameDico metadata

## License

[MIT](LICENSE). `package.json` stays `"private": true` so this is not published to npm by accident.
