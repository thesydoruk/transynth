# 16 — Vortex: the agent and manual sync

> [!WARNING]
> **Experimental.** The agent reads a real Vortex staging folder and a real game
> installation and writes only into Vortex's downloads folder. Start with
> `--dry-run` and check the result before relying on it.

A Vortex staging folder (unpacked folders after FOMOD) and the official game files land in
a **separate group** on the server. The group never overwrites mods uploaded through the
web UI or pulled from Nexus. A **resident agent** on the Vortex machine mirrors it;
translation and voice start from the Vortex page in the web UI, when their hosts are up.

---

## Table of Contents

- [The agent](#the-agent)
- [The Vortex page](#the-vortex-page)
- [Manual runs (CLI)](#manual-runs-cli)
- [The group on the server](#the-group-on-the-server)
- [Game releases](#game-releases)
- [Token](#token)

---

## The agent

### Install

On the Windows machine that sees both the staging folder and the game, in a clone of
the repository:

```text
npm run vortex:agent -- --init
```

writes `%APPDATA%\Transynth\vortex-agent.json`. Fill in `gameDir` (the game's install
folder), `api` (the server) and `token` (the server's `TRANSYNTH_CLI_TOKEN`; an environment
variable of the same name wins over the file). `stagingPath` and `downloadsDir` default to
where Vortex keeps them (`%APPDATA%\Vortex\<game>\mods` and
`%APPDATA%\Vortex\downloads\<game>`); if you moved them in Vortex's settings, put the new
paths in.

```text
npm run vortex:agent -- --dry-run     # inventory and load order, no server call
npm run vortex:agent -- --once        # one tick, a sync if needed, exit
npm run vortex:agent                  # loop until Ctrl+C
```

To keep the agent alive, register a scheduled task that starts at logon
(`schtasks /create /sc onlogon /tn TransynthVortexAgent /tr "cmd /c cd /d <clone> && npm run vortex:agent"`)
with restart on failure, or call `--once` every few minutes.

### What it does on its own

Every `pollSec` (30 s) the agent looks at the staging folder listing and the load-order
files (`vortex.deployment.msgpack`, `plugins.txt`, `loadorder.txt`). After a change it
waits `settleSec` (90 s) of quiet, because Vortex installs a mod step by step and deploys
afterwards, then:

1. hashes the inventory (plugins, string tables, MCM, the needed BA2s, unpacked clips)
   through a size+mtime cache, so the game's multi-gigabyte archives are read once;
2. `plan` on the server, `upload` of new or changed units only;
3. `import` → `carry` (translations and finished takes carried over from the previous
   version);
4. `tm` — the same tm-apply jobs as the TM button in the editor; it reads the reference
   base, so official ESMs, DLC and known mods get reviewed translations at once;
5. sends the server the current load order and file winners. When only the order changed,
   it sends just that, without an upload.

`autoStages` in the config is a ceiling: `import`, `carry` or `tm`. The agent never goes
further, and a config with any other value does not load.

### What it never does

LLM translate, verify, skip-detect, gender-detect, voice, export. The LLM and TTS hosts are
not always on, so those stages are buttons on the Vortex page; a button stays disabled
while `/api/services` sees no healthy host of the kind the stage needs.

### The langpack

When the server has a new finished langpack, the agent downloads it into `downloadsDir`
as `Transynth_<game>_<lang>_langpack_r<N>.zip` (written as `.part`, then renamed), and
Vortex lists the archive on its Downloads tab and offers to install it. The agent never
writes into staging and never deletes anything in the downloads folder. Switch it off with
`"deliverLangpack": false`.

### Videos

With `"videos": true` the cutscene videos are part of the units as files of their mod:
`Data/Video` goes with the main master, a staging folder's `Video/` with its mod; the zip
carries a manifest in a video's place, and the agent uploads the files of the videos the
server registered and asked for through the heartbeat. The server reads, dubs and writes
the videos itself (ffmpeg in the web and worker images, RAD's BinkMix in `bethesda-tools`),
and the dubbed videos ship in the group's langpack at `Video/<file>.bk2`; nothing else is
installed on the Vortex machine. A video Vortex deployed from our own langpack is read from
`<file>.vortex_backup`, the game's file Vortex keeps next to it. The rest happens in the "Media" tab of the
mod's voice mode. See [Dubbing the cutscenes](18-video-dubbing.md).

### State and journal

`%LOCALAPPDATA%\Transynth\vortex-agent\`: `state.json` (signatures, last run, delivered
langpack), `hash-cache.json`, `journal.log` (JSON lines). A failed sync is retried after
1, 2, 4 … up to 30 minutes; a new change in staging resets the clock. A heartbeat goes out
every tick: the Vortex page shows the state, the last sync, what is pending, the last error.

---

## The Vortex page

Game hub → the **Vortex** card (`/games/<game>/vortex`): the agent panel, stage buttons
(Re-run TM, LLM translate, Verify, Skip-detect, Gender-detect, Voice, Export langpack), the
current run with per-mod progress and a Stop button, run history, the newest langpack to
download. Each button creates its own run; while one is in progress the others are
disabled.

A `tm`, `llm`, `verify`, `skip`, `gender` or `voice` stage starts, for each mod of the
group, the same job the editor would, one mod at a time: LLM and TTS see one job each, and
the editor's badges and stop buttons work as always. `import`, `carry` and `export` run
inside one `vortex-sync` job.

---

## Manual runs (CLI)

`npm run vortex:sync` stays for one-off work:

```text
npm run vortex:sync -- --staging "<staging>" --game-dir "<game>" --api http://127.0.0.1:3200 --stage tm
npm run vortex:sync -- --staging "<staging>" --game-dir "<game>" --channel game
```

Stages: `plan` → `upload` → `import` → `carry` → `tm` → `llm` → `verify` → `skip` →
`gender` → `voice` → `export`; `--stage` or `--from`/`--to` cut a range. `--channel game`
imports only the official masters (a game patch), `--channel mods` only the staging folder.
`--out` saves the langpack to the given file. `--dry-run` prints the inventory without the
API. There is no `install` stage any more: the agent delivers the langpack through Vortex's
downloads folder.

---

## The group on the server

Group key: game + staging path. A repeated sync updates the same group. Every mod and every
game master is its own row; a new version (another content hash) does not overwrite the old
one, the group has `is_current`. Carry-over and the langpack stay inside the group; TM
reads the whole base and the reference base, writes only into the group. The Mods page
lists them together with hand-uploaded mods, marked with a **Vortex** chip; the **Source**
filter (shown once a group exists) narrows the list to **Local imports** or to one
`Vortex · …` group. The editor is the same.

The langpack follows the load order and the file winners from the deployment manifest: it
ships the official game channel and only the staging mods whose folder is in the deployment
(the mod is enabled in Vortex). With synthesis present, `UASoundPack.esp` and
`UASoundPack - Main.ba2` are added.

## Game releases

Official ESMs from `Game\Data` that are not in staging are collected in
`vortex_game_releases`. The label is the ProductVersion of `Fallout4.exe`. A new patch is a
new release; the previous one stays.

## Token

When the server sets `TRANSYNTH_CLI_TOKEN`, the agent and the CLI pass it on their writes:
plan, unit uploads, starting a range, heartbeat, load order. The Vortex page's buttons and
every read are open, like the rest of the app.

After a schema change: `npm run db:init`.

---

← [Technology Stack](15-technology-stack.md) | [Home](README.md) | **Next: [Adding a Game →](17-adding-a-game.md)**
