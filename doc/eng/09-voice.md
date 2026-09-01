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
- [Settings](#settings)
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
   `AUDIO_INTEL_CACHE_DIR` (default `data/cache/audio-intel`). Compose does
   not start audio-intel — set the URL in `.env`.
5. **Voice tools** for Bethesda lip-sync: `npm run tools:install`, or
   `docker compose --profile tools run --rm cli npm run tools:install`.
   That installs FaceFXWrapper, Fonix data, and xWMAEncode under
   `data/tools/voice/`.

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
import, not into the extracted English voice archive. Disco writes localized
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
