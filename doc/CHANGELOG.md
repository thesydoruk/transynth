# Changelog

## 0.5.0 — 2026-09-13

Vortex collections, voice at scale, and Ukrainian output quality:

- **Vortex sync — experimental, and at a very early stage.** `npm run vortex:sync` imports an unpacked Vortex staging folder and the game's own masters into an isolated group that never touches mods uploaded through the web UI or pulled from Nexus. Stages (`plan` → `upload` → `import` → `carry` → `tm` → `llm` → `export` → `install`) run whole or as a range. The command reads a real staging folder and game install, and `--install-staging` writes back into staging: back it up and start with `--dry-run`. See [Vortex sync](uk/16-vortex-sync.md).
- **Langpacks follow the load order.** Export applies the Vortex load order and file-overwrite winners, and includes only mods actually deployed — the ESP flag in `plugins.txt` no longer decides. Mod and game versions are tracked per group, with earlier ones nested in the UI. Downloads stream, so a langpack over 2 GB can be saved.
- **Voice synthesis streams into the editor.** Speaker cards and rows update as each take finishes instead of at the end of the job. Synthesized takes are reused on carry-over and TM when the line and the source clip are both unchanged. Bethesda takes and TRDA response variants are indexed, so one line keeps every speaker's clip. Fallout 4 langpacks ship voice inside an uncompressed `UASoundPack` BA2, which the engine will play; loose `.fuz` it ignores.
- **FaceFX lips** are handed to FaceFXWrapper 0.51 rather than respelled inside Transynth.
- **Ukrainian prompts split by text kind.** Fallout 4 dialogue, item names, prose, quest text, MCM options and character-creation labels each get their own prompt, and dialogue is sent in scene windows so the model sees the exchange rather than a line in isolation. Raiders, cults and militias get distinct faction voices.
- **Player-gender leaks are recast, not hidden.** A line the player speaks or hears is rewritten into wording that reads for either gender, preferring present tense over impersonal officialese.
- **Strings reach the model as parts and slot ids**, so mask keys and raw `%s` can be neither dropped nor invented. Glossary terms are scoped per game, and MCM strings carry paired page / type / help context.
- **One quest tree replaces the four dialog tabs**, so a translator reads a whole conversation instead of hopping between scopes.
- **Reliability.** Stopping a job no longer leaves queue rows behind or deadlocks the chunk pool, stuck LLM jobs recover, and localized import conversion uses an lstring join.

## 0.4.0 — 2026-09-10

Voice clone quality in the editor:

- Fish Speech `X-Voice-Similarity` (ECAPA cosine vs the clone prompt) is stored on each dubbed take.
- Voice and Dialogs color-code the score with the same floors as fish_studio (`< 0.25` fail, `< 0.30` warn).
- The voice list rebuilds when synthesis stamps change, so a finished worker job shows new takes immediately instead of waiting out a cache TTL.

## 0.3.0 — 2026-09-06

Bethesda lips and tool isolation:

- Docker image clones `thesydoruk/linux-champollion` at build time and ships a native `Champollion` binary. The Windows zip installer, `tools:champollion`, and Wine 64-bit prefix are gone.
- Optional Compose profile `embedded-audio-intel` starts Whisper STT (`GET /health`, `POST /v1/audio/transcriptions`) without diarization, word timestamps, or API-key auth.
- Bethesda FaceFX lips respell Ukrainian dialogue into Fonix English phonemes (`привіт` → `prihveet`) so stock `USEnglish` can write a playable `.lip`. Input is resampled to 16 kHz so lip timing matches the clip.
- Compose profile `embedded-bethesda-tools` runs FaceFX and xWMAEncode in one Wine sidecar (`BETHESDA_TOOLS_URL`). The web/worker image no longer ships Wine.
- `bethesda-tools` keeps FaceFX Creation Kit mapped via FaceFXWrapper `serve` (one worker per Wine prefix). The sidecar image downloads the latest `thesydoruk/FaceFXWrapper` release at Docker build.

## 0.2.0 — 2026-09-01

Disco lockit markup and voice:

- Preserve Disco lockit quotes, `*italics*`, `'titles'`, and `--` through LLM translate/verify: mask as `¤Q¤` / `¤IT¤` / `¤TS¤` / `¤EM¤` before the model, then restore shape on save.
- Restore ZA/UM asterisk-censored slurs before translate and TTS so glossary and voice see the full word.
- Fold `«»` to ASCII quotes on every save; restore nested `'…'` that models flattened to inner `"…"`.
- Decide mixed Disco voice lines from audio-intel (Whisper) ASR, not clip duration. TTS is cut to the spoken quote span(s) when the transcript shows the narration is absent.
- Disco voice regenerate synthesizes WAV, not Bethesda FUZ/LIP.
- LLM payloads omit empty metadata and RAG scores; Disco `field` is gettext `msgctxt` only.
- Removed one-shot Disco/voice backfill and repair scripts after those migrations ran.

## 0.1.0 — 2026-08-29

First versioned snapshot of the self-hosted localization toolchain. Root, `web-ui`, and `worker` share this version.
