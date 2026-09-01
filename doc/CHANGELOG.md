# Changelog

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
