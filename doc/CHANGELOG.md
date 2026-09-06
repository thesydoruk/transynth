# Changelog

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
