# Changelog

## 0.7.0 — 2026-09-25

Transynth deploys itself, and Disco's voice list is whole:

- **Green commits on `main` deploy themselves.** CI runs the checks on every pull request and push, and on a green `main` publishes `ghcr.io/thesydoruk/transynth:<commit>` plus the bethesda-tools sidecar when it changed. The host pulls: `scripts/deploy.sh`, run every two minutes from a systemd timer, checks the commit out, backs up the database when `sql/` changed, applies the schema, restarts and waits for `web` to report healthy — and puts the previous commit and image back if any step fails. Nothing reaches into the host, so it can stay on a LAN. Self-hosters can pull the same images instead of building them. See [Configuration](uk/14-configuration.md#безперервний-деплой).
- **The test suite runs on Linux**, which it never had, and that found a real bug: Vortex groups on a Linux server were labelled with the client's whole Windows path instead of the staging folder.
- **Disco's unpaired takes have their text back.** A take is matched to its lockit row by position, and only when a conversation's counts agreed exactly — one unvoiced line blanked the whole conversation, 5,177 dialogue clips in all. Those conversations are now transcribed and each take is matched to the row it actually says; 4,736 of the 4,810 orphaned takes found their line, and a match below 0.30 stays blank rather than wrong. `npm run voice:reindex-takes` repairs a mod imported before this.
- **Disco's soundtrack is out of the voice list.** The score, ambience and door sounds share the dialogue folder and were indexed as 1,693 voice lines with invented speakers like `ambience` and `ants`. Actor names with hyphens (Mega Rich Light-Bending Guy and a dozen others) are no longer cut in half.
- **Voice synthesis retries a weak take.** When a take comes back silent, cut off or below the clone-similarity threshold, Transynth asks for more takes and keeps the best — configured in Settings → Voice → Synthesis. The regenerate dialog shows the clone score next to every attempt.
- **Fewer leaks in Fallout 4 dialogue.** English echoed back in a model's answer is stripped, an unnamed NPC's addressee is treated as the player, and the gender and register examples were tightened from a live review.
- **Database backups are several times faster** (`gzip -1`), and `scripts/backup.sh --container NAME` dumps a Postgres that is not part of the Compose project.

## 0.6.0 — 2026-09-15

A game is a plugin, and Ukrainian that reads like Ukrainian:

- **Adding a game means writing a plugin, not editing the whole codebase.** Everything a game decides — which records hold text, how its markup is protected, its prompts and glossary, its import, export, voice and deployment — lives in one folder under `src/games/` behind a single contract. Shared code no longer names a game or an engine: `GRUP`, `.esp` and Bethesda's record signatures stay inside the Creation Engine plugin, and a test fails the build when a new reference leaks out of one. See [Adding a game](uk/17-adding-a-game.md).
- **Disco Elysium dialogue has speakers.** The grid, the scene window and the prompts were resolving nobody for any of its 90,802 lines; the game now answers who speaks and who is spoken to, and 41,431 lines carry a resolved participant. Harry is named as the addressee, and a speaker's gender is read out of the surrounding text when the data does not state it.
- **Fewer gender and calque errors.** Speaker gender is no longer decided by a three-pronoun window, and internal voices, the player character and unnamed NPCs are handled explicitly instead of falling through to male. Eleven Russian-calque patterns are checked after the model answers; the four worth their tokens are also in the prompt.
- **Verify holds a line only on a proven defect.** A broken token, broken markup, a gender leak or a corrupted translation — things the system can check itself. A bare `suspicious` (calque, tone, register) is written to `qa_issues` as `llm_review` and shown in the editor, and the row goes to review instead of circling through a dozen rewrites. On base Fallout 4 that took the pool from 998 to 98; 771 of 869 rows approved, 721 carrying their critique. A rewrite that repeats a wording the row already had is refused, advice stops after five attempts, and a new wording has to beat the incumbent. A proven defect is never capped.
- **Gender repair is three prompts, not one.** A participant whose gender is known just needs the ending changed; a line the player says about themselves, or an NPC says to the player, needs a construction rewrite. One prompt covering all three contradicted itself and rewrote Curie's log from a correct feminine into a wrong impersonal. The branches run one after another. The detector now reads subjectless clauses and predicative adjectives — Ukrainian drops subjects constantly — and an inferred narrator gender is no longer evidence: only a person's own decision gates a narration row.
- **QA is visible while translating.** A dialogue row shows what QA found on it and whether the translation came from memory or the model, so a gender fix is findable instead of buried in another tab. Speaker colours now meet WCAG AA in both themes.
- **One `voice_clips` table for every game** instead of one per engine, with columns named for what they hold (`line_key`, not `formid_lower6`).
- **Documentation checked against the code.** Broken links, renamed scripts and undocumented features are fixed, dead CLI pages and one-off dev scripts are gone, and the Vortex sync page now says outright that the feature is experimental and at a very early stage.

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
