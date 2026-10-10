# Changelog

## 0.9.1 — 2026-10-10

- **A Witcher 3 import staged on one machine, run on another.** The game sits on the player's PC and Transynth may run on a server without it. `npm run import:folder -- --game w3 --dir <game> --langs en,ua --stage-to <folder>` copies only what the import uses — the tables, the voice container and the scene files taken out of the bundles, 4.3 GB rather than the game's 59 — and the folder import now plans scene files lying loose in a folder as they are. Moved to the server and imported with the same command, the staged folder lands under the same paths and the same content hash as the game folder would.

## 0.9.0 — 2026-10-10

The Witcher 3 (Remastered), text and voice:

- **A third game plugin.** `src/games/witcher3/` reads and writes the game's `.w3strings` tables (version 164, UTF-8; the key hash is over the lowercased key, which existing tools get wrong) and round-trips the shipped `en`, `pl`, `ru` and `ua` tables byte for byte. Remastered ships an official Ukrainian table, so importing the game brings 96,854 reviewed `uk` translations in with it, and the export reproduces that table entry for entry with the changed lines swapped in. Uploads take an archive; `npm run import:folder -- --game w3 --dir <install or mods folder>` reads an install or a mods folder in place, and is the generic folder import any plugin can offer.
- **Who says what.** Speakers come from the game's own scene files inside its `.bundle` archives: the voice tag of each line, who it is spoken to, and each tag's sex from `scene_voice_tags.csv`. Every one of the 64,718 voiced takes has a speaker (1,724 of them, all but 26 with a gender). Spoken lines are `W3D` records and reach the translator with the speaker's and the listener's gender; interface, books and journal are `W3S`. The dialogue view, the voice tab and the gender checks read the same data.
- **Voice without Wwise.** The game's takes are Wwise Opus inside a 4 GB `.w3speech` container, with a mouth animation per take in a bitwise-compressed buffer no public tool writes. Both are decoded and written here: the Opus packets are re-encoded with libopus in the layout the game expects (99.5% of re-encoded takes byte-identical), and the animation codec reproduces 64,708 of the game's 64,709 buffers exactly. `npm run w3:voice-pack` writes a `brpc.w3speech` for the Brazilian Portuguese slot, which the game has no Ukrainian one; `SpeechLanguage=BR` plays it.
- **A mouth model of our own.** Lip animation for a synthesized line is predicted from its audio by a small network trained on the animation CD PROJEKT RED made for the English takes (log-mel audio ±10 frames → 70 moving tracks of 148; held-out R² 0.54, jaw correlation 0.97). The trained weights ship with the plugin; `npm run w3:mimic-dataset` and `tools/witcher3-lipsync/train.py` retrain it from an install. Lip inference runs in worker threads that close after 5 s idle.
- **Cloning that knows the speaker.** Each line is cloned from its own take; a line too short to clone from alone adds its speaker's reference take or their longest other takes through the shared reference picker. Synthesis runs `voice.tts_max_parallel_fish_speech` lines at a time — for Disco Elysium too, which was sequential.
- **Prompts and glossary from the game's own Ukrainian.** The en→uk translate and verify prompts treat the scene genders as authoritative. The glossary was checked term by term against the official `ua` table and follows it where it departs from the book editions (Кер-Морен, Новіґрад, Скелліґе, Нільфґаард, Весемір, Реґіс, Дикий гін).
- Elder Speech in `{…}`, `<<Key>>` references and `$I$` tokens are masked out of translation like other markup. Voice routes accept the game's decimal line ids.

See [Voice](uk/09-voice.md#the-witcher-3-озвучення) and [Adding a game](uk/17-adding-a-game.md).

Two fixes from use:

- **Deleting a mod leaves a scanned plugin alone.** Delete removed every file the import job pointed at, and for a plugin registered in place by `scan:mods` that was the user's own `.esm` in the game folder. Only files inside mod storage or the Vortex upload area are removed now.
- **`npm test` runs in one recycled worker instead of one process.** Jest's ESM runtime keeps every finished suite's modules alive (about 13 MB a suite), so the 228 unit suites in one `--runInBand` process passed the default 4 GB heap and died with no suite reported. The suites still run one at a time, but `--workerIdleMemoryLimit` restarts the worker past 1.5 GB; the full run peaks at 1.75 GB whatever its size.
- **The app no longer freezes when Redis is down.** With the API up and Redis down, `/api/ai-jobs/active` never answered, the UI's 3-second poll piled requests behind it, and the browser's six connections per host filled up — every page looked dead. The route answers 503 within 3 s; the poll times out at 10 s and waits for one request to settle before sending the next.

Translations that outlive their mod:

- **A per-game reference base.** The translation memory was a query over other mods' rows, so deleting a mod forgot everything it had taught: strings, translations, RAG examples and synthesized voice went together. `reference_translations` holds reviewed and human translations with their TM anchors and no foreign key to any mod. TM auto-apply reads it ahead of live mods on the same anchor; an identical live source text still wins over a normalized-text reference match.
- **Three ways in, one way to protect.** Right-click → _Mark as reference_ in the editor; a _Keep reviewed translations in the reference base_ checkbox in every mod delete dialog, on by default, that snapshots before the purge; and a Workflow setting that promotes a translation the moment it becomes reviewed or human. A row edited by hand on the Reference page is never overwritten by a promotion.
- **An editable Reference page per game.** Game hub → _Reference base_: filter by language pair, search source, translation or EDID, add a pair by hand, edit or delete rows, and promote one mod or the whole game. Editions that share a glossary (Skyrim LE and SE) share a reference base.
- **A reference hit is approved on the spot.** TM auto-apply writes an exact match from the reference base as `reviewed`, not `tm`: the row was reviewed once already. A number transplant is new text and stays `tm`. Such rows carry `tm_reference_<method>` provenance, and the editor's TM toast counts them.
- Not yet: RAG examples and synthesized voice are still mod-bound. A reference row feeds TM matching only.

See [Translation memory](uk/05-translation-memory.md#еталонна-база). Run `npm run db:init` after pulling.

Usable from a phone or a tablet:

- **Device tests.** `npm --prefix web-ui run test:devices` opens every page on a desktop, a laptop, an iPad both ways round and three phones down to 320px, in Chromium and WebKit, against a fake API. It fails when a page grows wider than the screen, a top-bar control falls off it or is under 24px to tap, or an editor line cannot be opened by a finger. CI runs it on every pull request.
- **What they found, fixed.** On a phone the top bar pushed every page sideways, the Settings sidebar and label column left no room for the fields, wide tables widened the page, and mod rows crushed their names to nothing. The top bar now wraps to two rows and scrolls away, settings stack into one column, tables scroll inside their own box, and mod rows put progress and actions under the name.
- **The editor works by touch.** A tap opens a line (a mouse still selects on click and opens on double-click), the record-type list becomes a strip above the grid, original and translation stack, and the divider between grid and detail panel drags with a finger.
- **The editor fits a narrower window, not only a phone.** The grid's fixed columns needed about 1000px and could not scroll, so on a tablet or a small laptop source and translation sat past the edge; as the grid narrows it now drops Field, EDID, then FormID and the action buttons. The toolbar used to clip from the left on anything under ~1100px, hiding the mod name and the AI buttons; it now wraps.
- **A phone shows one thing at a time.** Opening a line in the editor used to split a 568px screen three ways, each part scrolling on its own; now the line opens as a full-screen sheet with a _Back to list_ button. The dialogue and voice screens put their navigator above the content instead of beside it, and the toolbar drops the language pickers and the shortcut help there. A _Row actions_ button in the detail panel opens the same menu as a right-click on the grid, so a finger (and anyone who never right-clicks) can reach it; the menu itself no longer runs past the bottom of a short screen.
- **Tables read as cards on a phone.** The glossary, the reference base and the QA rules stack each row's cells into a card instead of scrolling a five-column table sideways, so the edit and delete buttons are always in reach; on a tablet those buttons stay pinned to the right edge while the rest scrolls. The Settings tab strip scrolls the chosen tab into view and fades at the edge to show there is more.
- **Smaller fixes from looking at every page on every device.** Buttons and selects use the page font (WebKit drew some in a serif), dense tables keep a minimum width and scroll instead of breaking words letter by letter, long archive names no longer run over the import progress, and mod rows stack on tablets as well as phones.

Tests that run the SQL:

- **A database suite.** Until now no test ran a query against Postgres — the few query tests passed a fake `query` and checked the call. `npm run test:db` runs `*.db.test.ts` against a real one, the same pgvector image production uses; `npm run test:db:up` starts a throwaway server with its data in RAM, and CI runs the suite on every pull request. The suite refuses any database whose name does not end in `_test`, because it drops and recreates it.
- **What it covers first.** `db:init` re-applied over live data; TM auto-apply with the reference base (reference beats a live mod on the same anchor and is approved at once, an identical live source beats a normalised reference match, a number transplant stays `tm`, Skyrim LE and SE share one base); deleting a mod, with and without the reference snapshot, and the next version of the mod picking up what the deleted one taught; saving a translation, changing statuses, and the auto-promote setting. Each rule was checked by breaking it on purpose and watching a test fail.
- **The API that writes data, tested over HTTP.** Strings (save, clear, ignore, statuses, skip, TM apply), mods (delete, batch delete, empty, clear copies of the source), the reference base, project settings, the glossary, QA rules and deleting an import job go through the real routes with `app.inject`, against the same database.
- **What those tests caught.** Saving a line with a status the editor does not know stored it, and the line then matched no filter in any view; it is now refused. A blank glossary term was stored as an empty term. A `max_length` QA rule accepted `32px` (stored as 32px, read as 32), and an edit that changed only the value skipped the check entirely. A non-numeric import-job id in the URL reached SQL and came back as a server error instead of a 400.
- **The worker's decisions, without a model.** The chat call is replaced and nothing else: the real request is built and the real response parser throws the real errors. Translate keeps every validated row of a batch, restores placeholders, refuses a plain-text answer that lost one, retries a missing row on its own and a timed-out batch in halves; skip-detect asks the model only about what the heuristics left and marks nothing when the model fails; verify writes a fix for a proven defect only when its detector stops objecting, writes advice only when it beats the current wording, records the model's unaided objections on the row, approves what passed, never a rejected line, and writes nothing on a dry run.
- **Imports, tested on real files.** Plugins built byte by byte, real zip archives unpacked by 7-Zip, and synthetic ESP-ESM Translator files: registering an upload (sized by its strings, localized flag, the same file uploaded again under another name, Nexus details filled in but never overwritten), PEX script literals, MCM keys, and CSV and EET registration.
- **Import bugs those tests caught.** A CSV whose quoted field spans lines — book pages, long dialogue — was split on line breaks: the translation was lost and pieces of the text became FormIDs of phantom records. The parser now splits records the way RFC 4180 says, and the line-at-a-time parser it replaces is gone. Script text shown only through `Debug.MessageBox` was dropped from import when the script could not be decompiled, because the debug-call pattern read MessageBox as `Debug.Message`. The EET reader tests needed sample files that are not in the repository and so passed without checking anything; they now show as skipped, and synthetic EET files test the reader everywhere.
- **The web UI’s own logic, unit-tested.** Editor autosave, the editor’s filters and their place in the address, row selection (including “select all matching” with exceptions), the AI job poll and the translate runner, and the API client’s error handling.
- **Web UI bugs those tests caught.** Text typed in the editor and left within the 800 ms autosave window — a nav link, the back button — was thrown away; it is now saved on the way out. When a finished AI job’s “completed” badge was still showing, a new run of the same kind on the same mod stayed hidden, and the old badge never went away, so the new run’s end never showed either, until a reload.

EET and CSV uploads land under the right game:

- **Filed under the page they were uploaded on.** An EET or CSV upload sent no game, so every one became a Fallout 4 mod whatever page it came from, and nothing in the UI could change that afterwards. Both now carry the page's game and your source and target languages, as a mod upload does; a mod upload now sends the languages too. Uploading the same file from another game's page moves its mod there.
- **An EET file for another game is refused.** The EET header names its game. When that name clearly means a different game from the page — a `Skyrim` file on the Fallout 4 page — the upload is refused with a message saying which game the file is for, and nothing is written; an earlier upload of the same name is left intact. Editions that share their text count as one game, and a name no game claims is not checked. Refusing beats both alternatives: filing it under the page game imports Skyrim text into Fallout 4 before anyone reads a warning (the import starts on upload), and filing it under the header's game puts it on a page the user is not looking at.
- **A failed upload says so.** An error from any upload in the picker used to vanish and stop the rest of the selection; it now shows as a toast and the other files go on.

## 0.8.0 — 2026-09-25

Verify settles a line in one run, and the LLM pipeline stops working against itself under load:

- **A proven gender leak is repaired before the audit, not after it.** The leaking rows of a batch go to the gender pass first, the repaired wording is written, and the model then judges the text that will actually be approved. One verify run takes a line from leaking to `reviewed`; it used to take two, with an audit call spent on text the detector already knew was wrong. A line the pass cannot fix still blocks, and is not sent to the same pass again in the same run.
- **The gender pass offers three rewordings and the detector picks the first clean one.** Asking for one wording left one line in six unrepaired — the model's first attempt patched the verb or left a marker elsewhere. Measured on 60 real leaking Fallout 4 lines with the same detector on both sides: 55 clean before, 59 after. The detector also reads «відволікся» and «ти що, здурів?».
- **A fix for a proven defect answers to its detector; advice answers to the comparison.** A defect the system proved no longer goes through the model's "which is better" call — it is accepted when the detector stops objecting. The comparison stays for advice, and when it fails nothing is written: it used to keep every candidate, opening the gate exactly when the server was saturated (403 times in three days of production logs).
- **Glossary embeddings work for the first time.** The glossary's two thousand terms were sent to the embedding server as one request, refused with HTTP 413, and asked again on every batch — 54,558 refusals in three days, a wasted round trip per LLM call, and the semantic fill never ran. Terms are now embedded in batches, once per process; a failed build is remembered for ten minutes.
- **A timed-out batch retries in halves, not as one request per row.** Twenty-five solo requests each carrying the same ten-thousand-token system prompt were the worst reply to a saturated server; the logs show 204 batch timeouts turning into thousands of solo calls that timed out in their turn. Translate, verify and skip-detect now bisect.
- **A source rewrite keeps the rows the model did translate.** One row returned blank used to fail the whole batch, and the same few long sources sank their neighbours on every run.

See [LLM translation](uk/06-llm-translation.md#що-блокує-підтвердження).

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
