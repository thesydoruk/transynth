# 18 — Dubbing the cutscenes

> [!WARNING]
> **Experimental.** Run the first pass on one video and check it in the game before
> dubbing the rest. The audio is replaced; the picture is not touched.

A game's pre-rendered videos (Fallout 4: `Data/Video/*.bk2`, Bink 2 — the intro, the four
endings, the seven S.P.E.C.I.A.L. films) read neither the string tables nor the voice of a
langpack: their narration is mixed into the video itself. The dub brings it back in
Ukrainian, in the original narrator's voice, without re-encoding the video.

Four steps, each a button or an agent action:

```text
agent: Data/Video/*.bk2 → ffmpeg → the narration track (WAV) → server
   ↓
separation (audio-intel): speech / background, timed transcript → the "Video" mod
   ↓
translation as for any mod: TM, LLM, verify, editor
   ↓
dub (Fish Speech): a take per phrase, cloned from the video itself → mix over the background → dub_uk.wav
   ↓
agent: binkmix → Video/<file>.bk2 → videopack in Vortex's downloads
```

---

## Inventory: the agent

The [resident Vortex agent](16-vortex-sync.md) sees the videos, being the one process with
the game folder. In its config:

```json
"videos": true,
"ffmpegPath": "ffmpeg",
"ffprobePath": "ffprobe",
"videoSourceTrack": 1
```

- `videos` turns the scan on (off by default).
- `ffmpegPath` / `ffprobePath` — paths or names on `PATH`. ffmpeg demuxes a Bink container
  and decodes its audio; it decodes no Bink 2 video and encodes no Bink at all, so nothing
  but WAV leaves the machine.
- `videoSourceTrack` — the track id to upload when the video has it; otherwise the lowest
  id. Bink keeps one track per language (five in Fallout 4's S.P.E.C.I.A.L. films, English
  is 1; two identical ones in the intro and endings) and the game picks one by language.

Once per `fullScanEveryMin` the agent lists the videos, fingerprints each (size, mtime,
first MiB), asks `ffprobe` for the tracks and the length, registers every video on the
server (`POST /api/video/<game>/assets`) and, for those whose audio the server does not
hold, decodes the chosen track to 48 kHz stereo WAV and uploads it
(`PUT /api/video/<game>/<id>/audio`). A video the server holds with the same fingerprint
is skipped; a swapped file is registered anew and its old audio and dub forgotten. Silent
videos (the menu loop) are not registered. A scan failure goes to the journal and never
holds up the mod sync.

## The Video page

`/games/<game>/video` (a card on the game hub) lists every video: length, tracks, state,
a player (the original narration, or the dub once it exists) and the buttons. A button is
disabled while the host it needs (`separate`/`asr` for separation, `tts` for the dub) is
down, or while the video is busy with another job.

Clicking a video's name opens its phrases: time, speaker, source, translation with its
status, a player for the phrase itself (a slice of the speech track) and, after a dub, the
take's voice similarity, its speed-up and an "overrun" mark.

## Separation and transcription

**Separate & transcribe** starts `video-separate` (the `separate` queue, one video at a
time). audio-intel's batch lane splits the track into speech and background and
transcribes the speech with timestamps and speaker labels. The server keeps `speech.wav`
and `background.wav` next to the source (`data/uploads/video/<game>/<id>/`) and merges
the transcript into phrases: one speaker, pauses under 0.4 s, at most 12 s — the TTS
reference window.

The phrases become the records of the **`Video`** mod — one per game, origin `video`, no
Vortex group, one `INFO\NAM1` record per phrase (narration is translated with the
dialogue prompt), EDID `<video>#<index>`. From there everything that exists for mods
works on the narration: TM with the reference base, LLM translate, verify, the editor,
the glossary. A second separation keeps the string — and with it the translation and its
review — of a phrase whose text did not change.

## The dub

**Dub** starts `video-dub` (the `tts` queue). For every translated phrase:

1. **The reference is the video itself.** The first clip is the phrase's own slice of the
   speech track (widened to 1.2 s when shorter): Fish Speech fits the take's duration to
   the first `speaker_wav` (`match_timing`), so the take lands in the actor's slot. Then
   the nearest phrases of the same speaker (1.2–14 s each, at most three) until the
   reference carries 8 s of voice.
2. **Synthesis** under the project policy (Settings → Voice: similarity gate, retries);
   stage directions in `*…*` and `[…]` are dropped as in game lines.
3. **Fit.** A phrase's slot runs from its start to the next phrase minus 0.15 s. A take
   longer than its slot is sped up by at most 15 % (`atempo`); what still does not fit is
   marked **overrun** in the phrase list — the translation wants shortening.
4. **Mix.** The takes are laid on the timeline, summed into one speech bus, brought to the
   integrated loudness (LUFS) of the original narration and laid over the background →
   `dub_uk.wav`, which the row's player streams.

Every take carries a version of its translation and slot: **Dub changes** re-synthesizes
only the phrases that were retranslated or moved (`scope: changed`; `all` and
`segment:<index>` exist too). The mix is rebuilt every time from all the takes.

## Writing it back

Only the RAD Video Tools encode Bink 2 (Windows, free for non-commercial use). The agent
installs them itself: RAD's permanent link serves a 7z archive (password `RAD`, printed on
the download page) holding an NSIS installer holding `radvideo64.exe`. The agent unpacks
both layers in-process (7-Zip compiled to WASM), never runs the installer, and keeps the one
executable in `radVideoToolsPath` (default `%LOCALAPPDATA%\Transynth\vortex-agent\radtools`)
— on first need, or ahead of time with `npm run vortex:agent -- --install-rad-tools`.

The heartbeat tells the agent which videos have a finished dub not yet in their file. For
each, the agent downloads `dub_uk.wav`, reads the video's track ids with `ffprobe` and runs
`radvideo64.exe BinkMix <video> <wav> <out> /TrackID<id> /SoundCompress4 /Overwrite /AutoClose`
once per track (each pass reading the previous one's output), so the game hears the dub
whatever language it runs in; the picture is not re-encoded (Fallout 4's intro, two tracks:
4 s). On an error the mixer shows a dialog and waits for a click, so every pass runs under
a timeout and counts only with exit code 0 and an output file. The result goes to
`%LOCALAPPDATA%\Transynth\vortex-agent\videopack\<game>\Video\<file>.bk2`, the agent reports
it (`POST /api/video/:game/:id/packed`, state "written into the video") and, once every
pending video is done, zips the whole folder into
`Transynth_<game>_<lang>_videopack_r<N>.zip` in Vortex's downloads — a mod of its own next
to the langpack, because the videos weigh gigabytes. Vortex deploys `Video\*.bk2` over the
game's files. The agent never writes into the game folder.

## API

| Method | Path                                                  | What it does                                                |
| ------ | ----------------------------------------------------- | ----------------------------------------------------------- |
| GET    | `/api/video/:game`                                    | The game's videos with state and host health (`services`)   |
| POST   | `/api/video/:game/assets`                             | The agent registers a video (token)                         |
| PUT    | `/api/video/:game/:id/audio`                          | The agent uploads the track (multipart WAV, token)          |
| GET    | `/api/video/:game/:id/audio/:kind[?from&to]`          | `source`, `speech`, `background`, `dub`; a slice in seconds |
| GET    | `/api/video/:game/:id/segments`                       | The phrases with translation and takes                      |
| POST   | `/api/video/:game/:id/separate`                       | The `video-separate` job (409: busy or no host)             |
| POST   | `/api/video/:game/:id/dub`                            | The `video-dub` job, body `{ "scope": "changed" }`          |
| POST   | `/api/video/:game/:id/packed`                         | The agent wrote this dub version into the video (token)     |
| GET    | `/api/video-separate/:jobId`, `/api/video-dub/:jobId` | Job status; `POST …/stop` stops it                          |

Tables: `video_assets` (video, fingerprint, tracks, state, mod, dub) and `video_segments`
(phrases, the mod's string, take, speed-up, `overrun`).
