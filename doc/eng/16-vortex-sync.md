# 16 — Vortex Sync

> [!WARNING]
> **Experimental, and at a very early stage.** This command reads a real Vortex
> staging folder and a real game installation, and `--install-staging` writes a
> mod back into staging. Expect rough edges and breaking changes between
> versions. Back up the staging folder before the first run, start with
> `--dry-run`, and treat the result as something to check rather than trust.

Import an unpacked Vortex staging folder and the official game files into a
**separate group** on the server. The group never overwrites mods uploaded
through the web UI or pulled from Nexus.

---

## Table of Contents

- [The command](#the-command)
- [Stages](#stages)
- [The group on the server](#the-group-on-the-server)
- [Game releases](#game-releases)
- [Token](#token)

---

## The command

Run it on the Windows machine that can see both the staging folder and the game:

```text
npm run vortex:sync -- ^
  --staging "D:\Vortex Mods\fallout4" ^
  --game-dir "D:\Games\Fallout4" ^
  --api http://127.0.0.1:3200 ^
  --game fo4 --tgt-lang uk
```

The source is the **unpacked folders** left after FOMOD, not the `.zip` / `.7z`
files in staging. The zip on the wire is only transport for that tree.

Game and mod BA2/BSA archives are **not unpacked locally** — the ones that are
needed travel as they are. Only what is being imported, or needed for
synthesis, is sent:

- plugins (`.esp` / `.esm` / `.esl`)
- string tables, `.pex`, MCM / `Translate_*.txt`
- GNRL `* - Main.ba2`, `* - Interface.ba2`, `* - Voices*.ba2` (and the same as BSA)
- loose clips under `Sound/Voice/**/*.fuz|xwm|wav`

Meshes, Sounds, Textures, Animations and the rest of the asset dump are not
uploaded. A folder with no plugin and no MCM/Interface `.txt` — F4SE itself, for
example — is skipped, because the importer would not register it.

`--dry-run` prints the inventory without calling the API.

---

## Stages

`plan` → `upload` → `import` → `carry` → `tm` → `llm` → `export` → `install`

`--stage tm` does not hash the staging folder and does not run `vortex-sync`.
The CLI starts the same `tm-apply` jobs the TM button in the editor does, and
waits for every mod in the group.

| Flag                                 | What it does                                                       |
| ------------------------------------ | ------------------------------------------------------------------ |
| `--stage tm`                         | Run one stage                                                      |
| `--from import --to tm`              | Run a contiguous range                                             |
| `--channel game`                     | Official masters only — a game patch                               |
| `--channel mods`                     | Staging only                                                       |
| `--install-staging`                  | Unpack the langpack into staging as `Transynth UK Langpack`        |
| `--apply-order`                      | Merge the langpack by Vortex load order and file winners (default) |
| `--no-apply-order`                   | The older alphabetical merge                                       |
| `--plugins-txt` / `--vortex-profile` | An explicit `plugins.txt` / `loadorder.txt`, or a profile          |

Export reads `%LOCALAPPDATA%\Fallout4\loadorder.txt` and
`vortex.deployment.msgpack` from staging. The langpack takes the official game
channel plus only those staging mods whose folder appears in the deployment —
that is, the ones actually enabled in Vortex. The ESP flag in `plugins.txt` does
not count. Plugins enter the ZIP in load order, and a path collision goes to
whichever mod Vortex recorded as the winner for that path. The `en` / `ru` slots
and the font patch behave as in an ordinary langpack (Ukrainian is unofficial).
When synthesis has run, `UASoundPack.esp` and an uncompressed
`UASoundPack - Main.ba2` are added. `--no-apply-order` keeps the alphabetical
merge but still drops mods that are not deployed.

---

## The group on the server

The group key is the game plus the staging path, so a repeated sync updates the
same group.

Every mod and every game master is its own row. A new version — a different
content hash — does not overwrite the old one; the group carries `is_current`
the way game releases do. Carry-over, TM and the langpack default to current
versions only. Earlier ones stay archived: they appear in the mod list behind a
disclosure, with the version in the name.

Carry-over and the langpack stay inside the group. TM reads the whole database
but writes only into the group.

In the web UI, the **Local imports** source on the Mods page does not show
Vortex jobs. They live under the `Vortex · …` group. The editor is the same.

---

## Game releases

Official ESMs from `Game\Data` that staging does not contain are collected into
`vortex_game_releases`. The label is the ProductVersion of `Fallout4.exe`. A new
patch is a new release; the previous one stays for diffing.

```text
npm run vortex:sync -- --staging ... --game-dir ... --channel game
```

---

## Token

When the server sets `TRANSYNTH_CLI_TOKEN`, the CLI has to pass the same value
via `--token` or the environment variable. GET endpoints — the group list — stay
open for the UI.

After a schema change: `npm run db:init`.

---

← [Technology Stack](15-technology-stack.md) | [Home](README.md) | **Next: [Adding a Game →](17-adding-a-game.md)**
