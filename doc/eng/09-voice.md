# 09 — Voice

Synthesize localized voice-over from reviewed translations. Transynth clones
the original speaker with an external **Fish Speech** service, then wraps the
audio for Bethesda games (FUZ / LIP) or writes WAV files for Disco Elysium.

You need a legal copy of the game (and usually the Creation Kit) for lip-sync
tools. See [THIRD_PARTY.md](../THIRD_PARTY.md).

---

## Table of Contents

- [What you need](#what-you-need)
- [Voice mode](#voice-mode)
- [Dialogs playback](#dialogs-playback)
- [Running synthesis](#running-synthesis)
- [Disco: what gets spoken](#disco-what-gets-spoken)
- [Disco: which line a take belongs to](#disco-which-line-a-take-belongs-to)
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
   FaceFXWrapper at build. `npm run tools:install` (or the `tools` Compose profile)
   copies Fonix data and xWMAEncode into `data/tools/voice/` for the sidecar
   to mount.

Disco Elysium does not use FaceFX. Synthesized lines are WAV files inside the
exported Final Cut langpack. Per-line regenerate also goes through WAV, not
Bethesda FUZ / LIP.

---

## Voice mode

Open a mod and switch the toolbar to **Voice**
(`?mode=voice` on `/games/:gameId/mods/:id`).

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

Progress streams while the job runs. You can stop it from the same control.

Per-line regenerate in Voice mode opens a small dialog (keep current
reference settings or override line-reference for that take).

Output for Bethesda is written under `_localize_{hash}/{lang}/` next to the
import, not into the extracted English voice archive. FO4 langpack export
packs those clips into uncompressed `UASoundPack - Main.ba2` plus dummy
`UASoundPack.esp`. Disco writes localized
`.wav` files into the langpack tree.

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

## Settings

**Settings → Voice** (`/settings?tab=voice`):

| Control                 | Where it lives                            | Effect                                                                                           |
| ----------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| TTS server URL          | `.env` `TTS_BASE_URL`                     | Shown read-only                                                                                  |
| audio-intel URL         | `.env` `AUDIO_INTEL_BASE_URL`             | Whisper for Disco spoken spans; not shown in the UI                                              |
| Fish Speech parallelism | `project_settings`                        | Max concurrent synthesize requests (1–32)                                                        |
| Line reference          | `project_settings` `voice.line_reference` | Clone from the original line clip when it is short enough; otherwise fall back to a speaker clip |
| Per-game timing match   | `project_settings`                        | Stretch/pad synthesized audio toward the original line length                                    |

Game hub **Voice** is a link to this tab, not a separate page.

Carry Over and **Apply TM** copy an existing take into the new mod when both
the line text and the character's source voice file match. **Voice → Missing**
runs the same pass first, then synthesizes only what could not be copied.
**All** (full regenerate) does not reuse.

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
