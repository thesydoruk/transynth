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
paths in. On a second computer, `group` joins it to the first one's group — see
[Several machines on one group](#several-machines-on-one-group).

```text
npm run vortex:agent -- --dry-run     # inventory and load order, no server call
npm run vortex:agent -- --once        # one tick, a sync if needed, exit
npm run vortex:agent                  # loop until Ctrl+C
```

To keep the agent alive, tick the autostart box on [the agent's page](#the-agents-page),
or register a scheduled task that starts at logon
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
   base, so official ESMs, DLC and known mods get reviewed translations at once.
   `carry` and `tm` touch only the mods this sync imported; a first sync, a retry after a
   failed one and **Sync now** go over the whole group, and so does the TM button;
5. sends the server the current load order and file winners. When only the order changed,
   it sends just that, without an upload.

`autoStages` in the config is a ceiling: `import`, `carry` or `tm`. The agent never goes
further, and a config with any other value does not load.

### What it never does

LLM translate, verify, skip-detect, gender-detect, voice, export. The LLM and TTS hosts are
not always on, so those stages are buttons on the Vortex page; a button stays disabled
while `/api/services` sees no healthy host of the kind the stage needs.

### The langpack

When the server has a new finished langpack for this machine, the agent downloads it into `downloadsDir`
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

### The agent's page

While it loops, the agent serves a page of its own at `http://127.0.0.1:3220/` (`uiPort`
in the config; `0` or `--no-ui` turns it off, `--once` never serves it). It shows what the
agent is doing right now (the mod being uploaded, the run and its stage, the langpack
download with its progress), the countdown to a sync or to the next attempt after a
failure, whether the server answered the last heartbeat, the last scan, the folders the
server refused, the paths and settings in use and the newest journal entries. Four buttons:

- **Sync now** — plans with the server and runs the stages again without waiting for the
  settle window, the retry delay or the next full scan;
- **Pause / Resume** — while paused the agent only sends heartbeats: no sync, no upload, no
  delivery (Sync now still runs one). A restart resumes;
- **Deliver langpack again** — forgets which archive was delivered, so the newest one is
  put into Vortex's downloads again (a file that is already there is left alone);
- **Stop agent** — the same as Ctrl+C: it ends after the step it is on.

Under **Settings** the page edits the config file: every key of `vortex-agent.json`,
checked the way the agent checks the file when it starts (the game and staging folders
must exist, `autoStages` never goes past `tm`), and nothing is written when a check fails.
The token can be set or cleared there but is never shown. After a save the agent finishes
the step it is on and starts its loop again with the new settings; only `uiPort` waits for
the next start. A first run needs no `--init`: start the agent, open the page — it comes
up in setup mode — fill in the game folder and save.

**Start the agent when I sign in to Windows** writes a launcher,
`Transynth Vortex agent.cmd`, into your Startup folder
(`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`); unticking it deletes the
file. No scheduled task, no administrator rights. The launcher starts the agent minimised
from the clone the page was served from and starts it again 30 seconds after a crash; an
agent stopped from the page or with Ctrl+C stays stopped until the next sign-in.

The page is for the person at this machine: it listens on loopback only, refuses a request
addressed to any other host name, takes a command only from itself, and never shows the
token. A second agent on the same port runs without a page and says so in its log.

### State and journal

`%LOCALAPPDATA%\Transynth\vortex-agent\`: `state.json` (signatures, last run, delivered
langpack), `hash-cache.json`, `journal.log` (JSON lines). A failed sync is retried after
1, 2, 4 … up to 30 minutes; a new change in staging resets the clock. A heartbeat goes out
every tick: the Vortex page shows the state, the last sync, what is pending, the last error.

---

## The Vortex page

Game page → the **Vortex** link (`/games/<game>/vortex`): a panel for every machine that
syncs into the group (its agent's state, paths, mods in staging, game version and the
langpack made for it), stage buttons
(Re-run TM, LLM translate, Verify, Skip-detect, Gender-detect, Voice, Export langpack), the
current run with per-mod progress and a Stop button, run history, the newest langpack to
download. Each button creates its own run; while one is in progress the others are
disabled.

With two or more machines a **Stages for** list appears above the buttons: _all machines_
or one of them. Export langpack needs one chosen — a langpack is one machine's mods in its
load order; the other stages cover every machine's mods unless one is chosen. An offline
machine has a **Forget this machine** button, for a computer that no longer syncs or whose
host name changed (`DELETE /api/vortex/groups/:id/machines/:machineId`): the mods,
translations and langpacks stay, and a version only that machine held is archived where
another machine holds a different one.

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

### Several machines on one group

Two computers whose staging path is the same (the default path holds the Windows user
name) sync into the same group. A computer with another path joins through `group` in its
agent's settings (`--group` for the CLI): the staging path of the computer whose group it
joins, exactly as that computer's panel on the Vortex page shows it, or a name both
computers set. The computer that already syncs needs no change when the other one names
its path.

A computer never starts a second group for the same game. If its staging folder moves, or
its `group` names a group that does not exist, the server answers 409 and creates nothing
(a second group would upload the whole load order again); the message carries the `group`
value that keeps the computer where it is. Naming a group that exists moves the computer
there: the agent then plans again so that group learns what this machine holds, and
uploads only what the group lacks. Computers are told apart by host name.

The mods are shared: a folder with the same content is one
mod on the server, uploaded once, with one set of translations and takes, whichever
computer brought it. What differs between computers belongs to the **machine** (the agent's
host name, one `vortex_agents` row):

- the mods its staging holds (`present_mod_ids`) — a version is current (`is_current`)
  while some machine holds it, so a computer that stays on an older version of a mod does
  not lose it when another one updates;
- its load order and file winners (`export_order_json`);
- its game release (`game_release_id`) and its paths.

On the Mods page, once the game's mods are on two machines, each row shows a chip per
machine that holds it and the toolbar gets a **Machine** filter; two versions of one mod
that two machines run are two rows.

A langpack is exported for one machine: its mods, its load order. The agent downloads only
the langpack made for its own machine. With one machine nothing has to be chosen;
`POST /api/vortex/groups/:id/stage/export` with two or more needs `agentId` (the page asks),
and answers 400 without it. `tm`, `llm`, `verify`, `skip`, `gender` and `voice` cover the
mods of every machine unless `agentId` narrows them to one.

Restart the agent on every computer after updating: an agent that does not name its machine
is taken for the group's only machine, and with two machines its load order cannot be told
apart. A group synced before machines existed hands its state to the machine seen last,
once, when the server starts.

## Game releases

Official ESMs from `Game\Data` that are not in staging are collected in
`vortex_game_releases`. The label is the ProductVersion of `Fallout4.exe`. A new patch is a
new release; the previous one stays, and stays current while a machine still runs it.

## Token

When the server sets `TRANSYNTH_CLI_TOKEN`, the agent and the CLI pass it on their writes:
plan, unit uploads, starting a range, heartbeat, load order. The Vortex page's buttons and
every read are open, like the rest of the app.

After a schema change: `npm run db:init`.

---

← [Technology Stack](15-technology-stack.md) | [Home](README.md) | **Next: [Adding a Game →](17-adding-a-game.md)**
