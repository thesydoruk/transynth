# 18 — Dubbing the cutscenes

> [!WARNING]
> **Experimental.** Run the first pass on one video and check it in the game before
> dubbing the rest. The audio is replaced; the picture is not touched.

A game's pre-rendered videos (Fallout 4: `Data/Video/*.bk2`, Bink 2 — the intro, the four
endings, the seven S.P.E.C.I.A.L. films) read neither the string tables nor the voice of a
langpack: their narration is mixed into the video itself. The dub brings it back in
Ukrainian, in the original narrator's voice, without re-encoding the video.

A video belongs to a mod, the way MCM files do: the game's own videos to its main master
(`Fallout4`), a mod's videos to that mod. Everything that happens to them shows in that
mod's editor.

```text
agent: Video/*.bk2 as part of a unit → a manifest in the zip → the server registers the mod's videos
   ↓
agent: ffmpeg → the narration track (WAV) → server
   ↓
separation (audio-intel): speech / background, timed transcript → VIDEO records of the mod
   ↓
translation as for any string: TM, LLM, verify, editor
   ↓
dub (Fish Speech): a take per phrase, cloned from the video itself → mix over the background → dub_uk.wav
   ↓
agent: binkmix → Video/<file>.bk2 → videopack in Vortex's downloads
```

---

## Inventory: the agent

The [resident Vortex agent](16-vortex-sync.md) sees the videos, being the one process with
the game folder and the staging. In its config:

```json
"videos": true,
"ffmpegPath": "ffmpeg",
"ffprobePath": "ffprobe",
"videoSourceTrack": 1
```

- `videos` puts the videos into the inventory (off by default).
- `ffmpegPath` / `ffprobePath` — paths or names on `PATH`. ffmpeg demuxes a Bink container
  and decodes its audio; it decodes no Bink 2 video and encodes no Bink at all, so nothing
  but WAV leaves the machine.
- `videoSourceTrack` — the track id to send when the video has it; otherwise the lowest
  id. Bink keeps one track per language (five in Fallout 4's S.P.E.C.I.A.L. films, English
  is 1; two identical ones in the intro and endings) and the game picks one by language.

With videos on, `Video/*.bk2` are part of a unit's files: the ones in `Data/Video` belong
to the main master's unit, the ones in a mod's staging folder to that mod's (a folder of
nothing but videos is a unit too). A video's hash is the file's plain sha1 from the agent's
cache, so a changed video changes the mod's version. A video Vortex deployed from our own
videopack is read from `<file>.vortex_backup`, the game's file Vortex keeps beside it;
otherwise the previous dub would count as a new video. The videopack's own staging folder
is skipped, like the langpack's.

The video itself never travels in the unit zip: a manifest, `Video/<file>.video.json`
(name, size, sha1, length, track ids, source track), stands in for it. The mod's import
registers an asset from it (`video_assets`, one row per mod and file). The heartbeat then
hands the agent the videos whose track is not uploaded yet; the agent finds the file by
hash in its inventory, decodes the chosen track to 48 kHz stereo WAV and uploads it
(`PUT /api/mods/<mod>/video/<id>/audio`). Silent videos (the menu loop) are registered
but get no track.

**A new version of the mod.** Every Vortex import is a new `mods` row, hence a new asset.
When the file is the same (same sha1), the import carries the separation, the phrases,
their takes and the dub over from the previous version: the audio derived from the file
alone (source, speech, background) is kept by hash and shared between versions; the takes
and the dub are copied into the new asset's folder. The `VIDEO` records are rewritten from
the carried phrases, so the import's prune leaves them alone, and carry-over picks their
translations up by the same key.

## Where it lives in the UI

The mod editor's **Voice** mode has two tabs: **Characters** (lines by speaker, as before)
and **Media** — the mod's videos: length, tracks, state, a player (the original narration,
or the dub once it exists) and the buttons. The tab shows only for a game with videos. A
button is disabled while the host it needs (`separate`/`asr` for separation, `tts` for the
dub) is down, or while the video is busy with another job.

Clicking a video's name opens its phrases: time, speaker, source, translation with its
status, a player for the phrase itself (a slice of the speech track) and, after a dub, the
take's voice similarity, its speed-up, an "overrun" mark and a player for that phrase's dub.
"Open the VIDEO strings" leads to the strings grid filtered by signature.

In the strings grid the phrases are **`VIDEO`** records: the key in the path
(`VIDEO\<video>\<index>`), no FormID, EDID `<video>#<index>` — the shape MCM text has. The
detail panel of such a record shows two players above the source: the phrase in the video
and its dub. The LLM translates narration with the dialogue prompt.

## Separation and transcription

**Separate & transcribe** starts `video-separate` (the `separate` queue, one video at a
time). audio-intel's batch lane splits the track into speech and background and
transcribes the speech with timestamps and speaker labels. The server keeps `speech.wav`
and `background.wav` next to the source (`data/uploads/video/src/<sha1>/`) and merges the
transcript into phrases: one speaker, pauses under 0.4 s, at most 12 s — the TTS reference
window.

The phrases become `VIDEO` records of the mod, one per phrase. From there everything that
exists for strings works on the narration: TM with the reference base, LLM translation,
verify, the editor, the glossary. A second separation keeps the string — and with it the
translation and its review — of every phrase whose text did not change.

## The dub

**Dub** starts `video-dub` (the `tts` queue). For every translated phrase:

1. **The reference is the video itself.** The first clip is the speech track's own slice
   of that phrase (widened to 1.2 s when shorter): Fish Speech fits the take's length to
   the first `speaker_wav` (`match_timing`), so the take lands in the actor's slot. Then
   the nearest phrases of the same speaker (1.2–14 s, up to three) until the reference
   reaches 8 s.
2. **Synthesis** under the project's policy (Settings → Voice: similarity gate, retries);
   remarks in `*…*` and `[…]` are dropped, as for game lines.
3. **Fitting.** A phrase's slot runs from its start to the next phrase minus 0.15 s. A
   take longer than its slot is sped up by at most 15 % (`atempo`); what still does not
   fit is marked **too long** in the phrase list — the translation wants shortening.
4. **The mix.** The takes are laid on the timeline, summed into one speech bus, brought to
   the integrated loudness (LUFS) of the original narration and laid over the background →
   `dub_uk.wav` in the asset's folder (`data/uploads/video/assets/<id>/`), 48 kHz 16-bit
   stereo: Bink stores the rate in 16 bits, and the 192 kHz `loudnorm` leaves behind plays
   as silence in the game.

Every take carries a version of its translation and slot: **Dub changes** re-synthesizes
only the phrases that were retranslated or moved (`scope: changed`; `all` and
`segment:<index>` exist too). The mix is rebuilt every time from all the takes, and its
format is part of the dub's version, so a change to the mix reaches the game without a new
take.

## Writing it back

Bink 2 is written by RAD Video Tools alone (Windows, free for non-commercial use). The agent
installs them itself: RAD's permanent link serves a 7z archive (password `RAD`, as stated
on the download page), inside it an NSIS installer, inside that `radvideo64.exe`. The agent
opens both layers in-process (7-Zip built to WASM), never runs the installer, and puts the
one exe into `radVideoToolsPath` (default `%LOCALAPPDATA%\Transynth\vortex-agent\radtools`).
That happens on first need, or ahead of time: `npm run vortex:agent -- --install-rad-tools`.

The heartbeat hands the agent the videos whose finished dub is not in the file yet. For each
the agent downloads `dub_uk.wav`, finds the video by hash in its inventory, reads the track
ids with `ffprobe` and runs
`radvideo64.exe BinkMix <video> <wav> <out> /TrackID<id> /SoundCompress4 /Overwrite /AutoClose`
once per track (every pass reads the previous pass's output), so the game hears the dub
whatever language it runs in; the picture is not re-encoded (Fallout 4's intro, two tracks:
4 s). The WAV is checked before the mixer: its rate must fit 16 bits and its format be 16-bit
PCM. On an error the mixer shows a dialog and waits for a click, so every pass runs under a
timeout and counts only with exit code 0 and an output file. The result goes to
`%LOCALAPPDATA%\Transynth\vortex-agent\videopack\<game>\Video\<file>.bk2`, the agent reports
it (`POST /api/mods/:mod/video/:id/packed`, state "written into the video") and, after all
videos, zips the whole folder as `Transynth_<game>_<lang>_videopack_r<N>.zip` into Vortex's
downloads — a mod of its own next to the langpack, since the videos weigh gigabytes. Vortex
deploys `Video\*.bk2` over the game's files. The agent never writes into the game's files. A
dub written in an earlier tick (the agent remembers hash and version) is not mixed again; the
server is only told again when a new version of the mod forgot it.

## API

| Method | Path                                                  | What it does                                                |
| ------ | ----------------------------------------------------- | ----------------------------------------------------------- |
| GET    | `/api/mods/:id/video`                                 | The mod's videos with state and host health (`services`)    |
| GET    | `/api/mods/:id/video/:videoId`                        | One video                                                   |
| PUT    | `/api/mods/:id/video/:videoId/audio`                  | The agent uploads the track (multipart WAV, token)          |
| GET    | `/api/mods/:id/video/:videoId/audio/:kind[?from&to]`  | `source`, `speech`, `background`, `dub`; a slice in seconds |
| GET    | `/api/mods/:id/video/:videoId/segments`               | The phrases with translations and takes                     |
| GET    | `/api/mods/:id/video/phrase/:stringId`                | The video and timing behind a `VIDEO` string (the players)  |
| POST   | `/api/mods/:id/video/:videoId/separate`               | Job `video-separate` (409: busy or no host)                 |
| POST   | `/api/mods/:id/video/:videoId/dub`                    | Job `video-dub`, body `{ "scope": "changed" }`              |
| POST   | `/api/mods/:id/video/:videoId/packed`                 | The agent wrote this dub version into the video (token)     |
| GET    | `/api/video-separate/:jobId`, `/api/video-dub/:jobId` | Job status; `POST …/stop` stops it                          |

The agent's heartbeat (`POST /api/vortex/agent/heartbeat`) returns `videoUploads` (the group's
videos without a track) and `videoTasks` (videos with an unwritten dub), both with `modId` and
the file's hash.

Tables: `video_assets` (a mod's video, hash, tracks, state, dub) and `video_segments`
(phrases, the mod's string, take, speed-up, `overrun`).
