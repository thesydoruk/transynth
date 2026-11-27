# 09 — Voice

Synthesize localized voice-over from reviewed translations. Transynth clones
the original speaker with an external **Fish Speech** service, then wraps the
audio for Bethesda games (FUZ / LIP), writes WAV files for Disco Elysium, and
rebuilds `.w3speech` voice files for The Witcher 3.

You need a legal copy of the game (and usually the Creation Kit) for lip-sync
tools. See [THIRD_PARTY.md](../THIRD_PARTY.md).

---

## Table of Contents

- [What you need](#what-you-need)
- [Voice mode](#voice-mode)
- [Dialogs playback](#dialogs-playback)
- [Running synthesis](#running-synthesis)
- [Shouted lines](#shouted-lines)
- [Disco: what gets spoken](#disco-what-gets-spoken)
- [Disco: which line a take belongs to](#disco-which-line-a-take-belongs-to)
- [The Witcher 3: voice](#the-witcher-3-voice)
- [Starfield takes](#starfield-takes)
- [Starfield lip animation](#starfield-lip-animation)
- [Settings](#settings)
- [Clip and response index](#clip-and-response-index)
- [Known limitations](#known-limitations)

---

## What you need

1. **Translated lines.** Synthesis uses the current target-language text.
   Untranslated or skipped lines are left alone.
2. **Reference audio** from the imported mod (and, for Bethesda, the game’s
   voice archives). Import unpacks `*Voices*.ba2` / BSA trees under
   `Sound/Voice/`.
3. **Fish Speech** reachable at `TTS_BASE_URL` (see `.env.example`). The URL
   is read-only in the UI; change it in `.env` and restart.
4. **audio-intel** at `AUDIO_INTEL_BASE_URL` (Whisper, separate from TTS).
   Disco needs it to cut narration away from spoken quote spans. Without the
   service the full lockit line goes to TTS. Transcripts are cached under
   `AUDIO_INTEL_CACHE_DIR` (default `data/cache/audio-intel`). An external
   server is a URL in `.env`. Or the `embedded-audio-intel` profile
   (`docker/compose.audio-intel.yml`): STT only, no diarization or UI. See
   [Getting Started](01-getting-started.md#optional-embedded-audio-intel).
5. **FaceFX** writes Bethesda `.lip` files. Cyrillic lines go to FaceFXWrapper
   as `Ukrainian` (the wrapper respells for stock Fonix). ASCII stays
   `USEnglish`. LIP and xWMA run in `bethesda-tools`
   (`BETHESDA_TOOLS_URL`, or profile `embedded-bethesda-tools`).
6. **Voice tools** on disk: the `bethesda-tools` image downloads the latest
   FaceFXWrapper, xWMAEncode (from the DirectX SDK) and RAD's `radvideo64.exe`
   (BinkMix, for the [cutscene dubs](18-video-dubbing.md)) at build. Only
   `FonixData.cdf` is yours to supply: `npm run tools:install --game-dir …` (or
   the `tools` Compose profile) copies it into `data/tools/voice/` for the
   sidecar to mount.
7. **Starfield lip animation** (`.ffxanim`, not `.lip`) comes from two console
   programs of the Starfield Creation Kit, which you supply too:
   `npm run tools:install -- --game-dir <Starfield folder with its Creation Kit>`
   copies its `Tools/LipGenerator` and `Tools/FaceFX` into
   `data/tools/voice/starfield/`. Starfield's own `FonixData.cdf` stays in that
   `LipGenerator` folder, apart from the Fallout one. See
   [Starfield lip animation](#starfield-lip-animation).

Disco Elysium does not use FaceFX. Synthesized lines are WAV files inside the
exported Final Cut langpack. Per-line regenerate also goes through WAV, not
Bethesda FUZ / LIP.

---

## Voice mode

Open a mod and switch the toolbar to **Voice**
(`?mode=voice` on `/games/:gameId/mods/:modId`).

Bethesda and Disco both have this mode. Disco has **no Dialogs** tab and no
INNR / gender-detect actions.

The left column lists **speakers**. Search filters the list. The right column
is that speaker’s lines: source, translation, play original / play synthesized,
and regenerate for a single line.

Filters hide lines that already have audio, still need a translation, or
already have a localized take. Footer hints list the hotkeys (same family as
Dialogs: `↑`/`↓`, `N` next todo, `P` play, `Enter` edit).

---

## Dialogs playback

On Bethesda games the **Dialogs** tab also plays source and synthesized audio
inline. A line without a usable reference shows a skip reason instead of a
play-translation button. Full transcript editing is documented in
[The Editor](03-editor.md).

---

## Running synthesis

The circular **Voice** control on the editor toolbar (and the same control on
the Mods list) starts a `voice-generate` job:

- **Missing** — only lines that do not yet have a localized take.
- **All** — regenerate every voiced line for the current language pair.
- **Low similarity…** — re-synthesize takes whose stored similarity score is
  below a threshold. Only stamped, scored takes are picked; unscored and missing
  takes are not included (use **Missing** for those). A small dialog sets four
  fields: the threshold (default: the `voice.synth_retry_below` project
  setting), the target similarity (default: not below the threshold), the number
  of retries (default: `voice.synth_retries`) and **Don't make it worse** (keep
  the old take when the new one does not score higher). It shows how many takes
  the threshold picks; from Voice mode it counts and runs for the selected
  character only. The job resumes correctly after a worker restart.

Progress streams while the job runs. You can stop it from the same control.

Per-line regenerate in Voice mode opens a small dialog (keep current
reference settings or override line-reference for that take).

Output for Bethesda is written under `_localize_{hash}/{lang}/` next to the
import, not into the extracted English voice archive. FO4 langpack export
packs those clips into uncompressed `UASoundPack - Main.ba2` plus dummy
`UASoundPack.esp`. Disco writes localized
`.wav` files into the langpack tree.

---

## Shouted lines

Cloned from a shouted original, a line usually comes out as raised talking. For
Creation Engine games Transynth can tell the TTS model which lines are shouted:
it sends them with an inline tag, `[shouting]` or the milder `[loud]`.

It works in three steps.

1. **Analyze the mod.** Mods page → the mod's voice menu → **Analyze vocal
   effort** (or `npm run voice:analyze-effort -- --mod=ID`). The job decodes
   every original take once and measures how hard the actor pushes — pitch and
   brightness, against the same speaker's calm lines (greetings, idles, scenes
   without `!`). It can be stopped and continues where it stopped; a base game
   takes a while the first time. Synthesis for the mod cannot start while it
   runs, and the other way round.
2. **Look at the result.** In Voice mode each line shows its tag next to the
   similarity score, and a filter lists the tagged lines. A line is `shouting`
   when its original take sounds pushed and the line says so itself — a `!` in
   the text or a shout in the actor note; a pushed take without that cue is
   `loud`. Click the tag to set it by hand (auto / shouting / loud / no tag):
   the analysis never overwrites a choice. A speaker with fewer than 30 calm
   lines is marked and gets no tags — there is nothing to judge that voice
   against.
3. **Switch it on.** Settings → Voice → the game → **Shout where the original
   shouts**. From then on tagged lines are synthesized with their tag. The takes
   of those lines made before become stale, so the next **Missing only** job
   makes them again; no other take is touched. Switching it off does the
   reverse to the takes made with a tag. The page says how many takes that is
   before it changes anything.

In the regenerate dialog a preview take can be made under another tag and
compared by ear; keeping it stores that tag for the line.

The tag is only sent to TTS. The spoken text, the lip animation and the take's
timing never see it.

---

## Disco: what gets spoken

Lockit lines often mix a quoted line with narration (`She says, "Okay."`).
That used to be decided from clip duration. It is now decided from an
**audio-intel** (Whisper) transcript of the English WAV.

- Distinct narration words in the transcript → TTS speaks the **whole** line.
- Those words absent (the actor only voiced the quotes) → TTS is cut to the
  matching quote span(s) in the translation. Several quotes can narrow to one
  when ASR matches only that index.
- Service down or no cache → the line stays whole, except `"A." She… "B."`:
  the middle narration between two quotes is never in the clip, so only the
  quotes are voiced.
- An empty transcript from a live service (almost no speech) also cuts to
  quotes: Whisper always recognizes prose.
- Low ASR confidence can still drop narration, but it **never** picks a
  single quote out of several.

Before TTS, Disco also:

- unwraps italic `*word*` to plain words (not a Fallout stage direction);
- strips UI brackets `[Leave.]`;
- restores lockit asterisk-censorship (`f****t` → the full word) so voice
  and glossary see the same canon as the LLM.

Lockit markup details: [LLM Translation](06-llm-translation.md#disco-lockit).

---

## Disco: which line a take belongs to

`Audio/` is one flat folder holding the takes **and** the soundtrack, ambience
and foley. Only a file named `{Actor}-{CONVERSATION}-{entry id}` for a
conversation the lockit knows counts as dialogue, so `city-birds-01` and
`01 Instrument of Surrender` never show up in Voice as lines without text.

A take carries no lockit id. Within one actor and one conversation, takes
(entry-id order) and `Dialogue Text` rows (lockit file order) run in step, so
equal counts pair them one for one.

A single unvoiced line breaks that count, and the conversation would then have
no text at all — hundreds of lines for a main character. Those conversations
are transcribed with **audio-intel** and each take is matched to the row it
actually says, leaving a gap where a row has no take. A take whose best row
still shares under 30% of its words keeps no text: blank beats the wrong line.
Matches made this way carry `game_data.match = {"by": "asr", "score": …}`.

Import does this on its own. A pack imported before this existed is fixed in
place — clip rows and speakers rebuilt from the pack, then the unmatched takes
transcribed:

```
npm run voice:reindex-takes              # every mod whose game infers it
npm run voice:reindex-takes -- --mod=12  # one of them
npm run voice:reindex-takes -- --no-audio   # rebuild rows, skip listening
npm run voice:reindex-takes -- --keep-rows  # listen only, no rebuild
```

On the Final Cut pack this listens to ~4 800 clips and takes around 40 minutes;
transcripts are cached, so a second run costs nothing. It recovers about 98% of
them — what stays blank is mostly `alternative-N` takes whose main take found no
row.

---

## The Witcher 3: voice

The game keeps every voiced line in one container per language,
`content/content0/enpc.w3speech` (64 718 lines, 4.2 GB for English): each row
an Opus take plus the mouth animation made for it, keyed by the string id of
its line. Import it from the install so the container comes along:

```
npm run import:folder -- --game w3 --dir "<game folder>" --langs en,ua
```

**Speakers.** The import reads who says each line from the game's own scene
files (`.w2scene` in the `.bundle` archives; a folder import stages just those,
not the archives): the speaker's voice tag, who they are speaking to, and each
tag's sex from `scene_voice_tags.csv`. On the Remastered game every voiced line
gets a speaker — 1,724 of them, all but 26 with a gender. Spoken lines become
`W3D` records whose speaker and addressee genders reach the translator; the
voice tab lists the takes by speaker.

The voice job clones every line from **its own take** and asks Fish Speech to
keep its timing; a line too short to clone from alone also gets its speaker's
reference take (the one picked in the voice tab, or auto-selected) or their
longer takes. Each result is stored under the localize directory as `<id>.wav`
beside the game's two blocks for it: the Opus take (encoded with libopus; no
Wwise) and the mouth animation.

**Mouth animation.** The animation is predicted from the new audio, frame by
frame, by a small model that ships with the plugin
(`src/games/witcher3/mimic/mimic-model.json`). It was learned from the game
itself — the animation CD PROJEKT RED made for every English take of the
Remastered release — and explains about half the variance of the held-out
tracks, with the jaw at 0.97 correlation. To retrain it from your own install:

```
npm run w3:mimic-dataset -- --speech "<game>/content/content0/enpc.w3speech" --out data/w3-mimic
python tools/witcher3-lipsync/train.py data/w3-mimic        # numpy + torch, CPU is fine
```

A copy at `<TOOLS_DIR>/witcher3/mimic-model.json`, or the file named by
`W3_MIMIC_MODEL_PATH`, is used instead of the bundled one. Without any readable
model, the original line's animation is stretched to the new length.

**Into the game.** The game has no Ukrainian voice slot, so the pack takes the
Brazilian Portuguese one:

```
npm run w3:voice-pack -- --mod <id> --out <dir>
```

writes `<dir>/content/content0/brpc.w3speech` — the original lines with the
synthesized ones swapped in. Copy it into the game's `content/content0`, then
choose Brazilian Portuguese as the voice language (or set `SpeechLanguage=BR`
under `[Localization]` in `Documents/The Witcher 3/user.settings`). The file
contains the game's own audio for every line not replaced: it is for your own
install, not for redistribution.

---

## Starfield takes

A Starfield take is `Sound/Voice/<Plugin>/<VoiceType>/<WEM id>.wem` with a sibling
`<WEM id>.ffxanim` — no `.fuz`, and no response number in the name. The WEM id is
the number the response's `TRDA` carries in the plugin, so a file is matched to
its line through an index of the plugin's INFO records, and a dub is written
under the same id beside the same voice type. Everything else — speakers, the
reference store, reuse, stamps, the Voice tab — works on the same keys as for
Fallout 4; a take without its `.ffxanim` counts as missing, and the langpack
ships the pairs as loose files.

**Codec.** The game's takes are Wwise Vorbis (`fmt ` tag 0xFFFF, the layout of
Wwise 2012 and later): nine in ten mono at 44.1 kHz, the rest at 32 or 48 kHz or
in stereo. Transynth reads and writes them without Wwise. A Wwise Vorbis take
carries no codebooks — it names them by index into a table built into the Wwise
runtime — so reading one rebuilds the Ogg Vorbis stream from the take and that
table (`src/formats/wem/data/packed_codebooks_aoTuV_603.bin`, from ww2ogg) and
decodes it with ffmpeg; the WAV is exactly as long as the take states. Writing is
the same rewrite backwards: ffmpeg's libvorbis encodes the WAV (quality 1, mono,
at the sample rate of the take being replaced), and the stream is packed into
the game's layout. That works because every codebook libvorbis uses is in the
runtime's table; a stream with one that is not is refused. The new take states
exactly the length of the WAV its lip animation was timed on. A source take in
another Wwise codec, or in an older Wwise Vorbis layout, is skipped with a
warning that names it. ffmpeg must be built with libvorbis (the distro package
is). Not yet checked in the running game: that it plays loose takes made here.
At 32 kHz their Vorbis setup is the game's own byte for byte; at 44.1 and 48 kHz
it differs from the game's in five positions of the floor curve, which any
Vorbis decoder reads from the take.

## Starfield lip animation

Starfield plays a FaceFX runtime animation, `<WEM id>.ffxanim`, beside each voice
take. `bethesda-tools` makes it with the Creation Kit's own two programs under
64-bit Wine (`POST /v1/ffxanim`), the way the Creation Kit does:

1. `LipGenerator.exe` analyses the WAV and the line with its Fonix data and writes
   an `.animset` for the human male or female face rig (the voice type's sex).
2. `ffxc.exe` compiles that into the `.ffxanim`. The take's WEM id names the WAV,
   the animation and its group inside the file.

Both programs report success when they fail, so the service checks each output
file and returns the tool's own output (LipGenerator's text, the end of ffxc's
log) when one is missing. The result is byte-identical to a native Windows run
of the same tools on the same WAV, name, text and rig.

**Text.** Fonix reads English phonemes only: Cyrillic is dropped, and the
analysis falls back to the audio. So the service handles the line as
FaceFXWrapper does for Fallout: `[tags]` are removed and Ukrainian is respelled
into English-phoneme spelling (`привіт` → `prihveet`). A line with nothing left
to read (`[Laughs]`, `...`) is analysed from the audio alone.

**Tools.** `npm run tools:install -- --game-dir <Starfield>` copies
`Tools/LipGenerator` and `Tools/FaceFX` (about 40 MB) into
`data/tools/voice/starfield/`; the sidecar mounts them and copies them once into
the container, because Wine cannot run them from a Windows bind mount. Without
them `/v1/ffxanim` answers 503 "Starfield lip tools are not installed" and the
rest of the service works as before; `GET /health` shows `tools.starfield`.

**Throughput.** About 0.4 s for LipGenerator and 3 s for ffxc per take on one
core. The takes run in one win64 prefix, as many at once as the FaceFX pool has
slots (`BETHESDA_TOOLS_WINE_SERVERS` × `BETHESDA_TOOLS_PER_WINE`).

---

## Settings

**Settings → Voice** (`/settings?tab=voice`):

| Control                 | Where it lives                            | Effect                                                                                           |
| ----------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| TTS server URL          | `.env` `TTS_BASE_URL`                     | Shown read-only                                                                                  |
| audio-intel URL         | `.env` `AUDIO_INTEL_BASE_URL`             | Whisper for Disco spoken spans; not shown in the UI                                              |
| Fish Speech parallelism | `project_settings`                        | Max concurrent synthesize requests (1–32)                                                        |
| Line reference          | `project_settings` `voice.line_reference` | Clone from the original line clip when it is short enough; otherwise fall back to a speaker clip |
| Per-game timing match   | `project_settings`                        | Stretch/pad synthesized audio toward the original line length                                    |

The game page’s **Voice** link goes to this tab, not a separate page.

Carry Over and **Apply TM** copy an existing take into the new mod when both
the line text and the character's source voice file match. **Voice → Missing**
runs the same pass first, then synthesizes only what could not be copied.
**All** (full regenerate) does not reuse.

Takes also outlive their mod. Every synthesized take is copied into the
**reference voice store** — table `reference_voice_takes`, files under
`_reference_voice/{game}/{lang}/` in mod storage — keyed by the SHA-1 of the
original voice file and the TTS payload version, with no link to a mod. The
reuse pass looks there after the live mods, so a mod deleted and imported again
gets its voice back without TTS. Per key the store keeps the take with the
higher similarity score. Deleting a mod with **keep reference** on copies its
current takes first; `npm run voice:reference:backfill -- --all` (or
`--mod <id>`, `--lang`, `--dry-run`) does the same for mods voiced before the
store existed. A take whose line text has changed since synthesis is not kept.

SHA-1 of each source `.fuz`/`.wav` is stored in `voice_source_file_hashes`
(with size and mtime). Later Carry Over / TM / Missing passes skip the NAS
read while the file is unchanged.

---

## Clip and response index

Every game indexes its takes in one shared `voice_clips` table: one row per
audio file, with the speaker, the game's own id for the line (`line_key`), and
whichever of `string_id` / `record_id` that game links text by. Anything only
one engine needs goes in `game_data`.

Bethesda import writes one row per speaker folder × FormID × TRDA response and
sets `strings.voice_variant`; one INFO with several NAM1 lines, or several
voice types (Nate/Nora, shared NPC lines), is several rows, and a DNAM alias
keeps its own FormID in `game_data` while pointing at the borrowed `string_id`.
Older imports backfill the index the first time Voice opens. Disco writes one
row per `.wav` stem, keyed to the `.po` record it belongs to.

---

## Known limitations

- Importing several per-language voice BA2/BSA archives that share the same
  internal `Sound/Voice/` paths keeps **only the last extracted archive**.
  Synthesized files under `_localize_{hash}/{lang}/` are not overwritten by
  that extract step.
- A bare `.ba2` upload is rejected. Put voice archives next to the plugin
  inside a zip/7z/rar, or let the importer discover sibling archives.
- Anyone who can reach the HTTP port can spend TTS budget. See
  [SECURITY.md](../../SECURITY.md).

---

← [Glossary](08-glossary.md) | [Home](README.md) | **Next: [Exporting →](10-export.md)**
