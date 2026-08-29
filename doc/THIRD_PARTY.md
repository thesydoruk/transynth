# Third-party tools and game-derived data

Transynth does **not** ship Bethesda game assets or Creation Kit binaries in git. `data/` is gitignored. Optional tools are installed at runtime into `data/tools/` by `npm run tools:install`.

You need a legal copy of the relevant game (and usually the Creation Kit) to use voice lip-sync features that depend on Fonix data.

## Downloaded by `npm run tools:install`

| Tool                                                          | Source                                                                  | License (upstream)                                                                                      | Notes                                                                                                     |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [Champollion](https://github.com/Orvid/Champollion) 1.3.2     | GitHub release zip                                                      | LGPL-3.0                                                                                                | Papyrus `.pex` decompiler. Installed under `data/tools/champollion/`.                                     |
| [FaceFXWrapper](https://github.com/Nukem9/FaceFXWrapper) 0.41 | GitHub release zip                                                      | Wrapper code: MIT. Uses Creation Kit–derived code and Bethesda resource files; those remain Bethesda’s. | Generates `.lip` files. Installed under `data/tools/voice/`.                                              |
| ffmpeg (Windows)                                              | [BtbN FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) `win64-gpl` | GPL (that build)                                                                                        | Only fetched when ffmpeg is not already on `PATH`. Linux/Docker use the distro `ffmpeg` package instead.  |
| xWMAEncode.exe                                                | Microsoft DirectX SDK (June 2010), if not copied from a game install    | Microsoft SDK terms                                                                                     | Large optional download. Prefer `--game-dir` when the file already exists in the game or CK tools folder. |

## You must supply (not redistributed)

| File                                          | Typical origin                                           | Why                                                                                                                    |
| --------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `FonixData.cdf`                               | Fallout 4 / Skyrim Creation Kit (or game `Tools` folder) | Fonix phoneme data. Bethesda / Occlusion. Pass `--game-dir` to copy it locally. **Do not commit or upload this file.** |
| Game voice samples, plugins, BA2/BSA archives | Your game and mods                                       | Required for import and TTS reference. Stay under `data/` (gitignored).                                                |

## Also used, not vendored in this repo

- **Wine** (32-bit and 64-bit) — Docker image only, to run the Windows `.exe` tools on Linux.
- **7-Zip** — both npm packages stay: `7zip-bin` ships `7za` (zip/7z), `7z-bin` ships full `7z` (RAR). `7za` cannot unpack RAR. See `src/tools/archiveUtils.ts`. Licenses ship with the packages.

## Game-derived metadata in git

These files are **names, FormIDs, and script identifiers** — not textures, audio, plugins, or STRING dumps. They exist so import, keyword masking, and EN→UK prompts work on a fresh clone. You still need a legal copy of the game (and any mods) to import real content.

Trademarks and in-game names remain with Bethesda Softworks / ZeniMax, ZA/UM (Disco Elysium), and their licensors. This repo does not claim those names.

| Path                                                            | What it is                                                                                                              | Origin                                                                                                                |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/resources/game-reference/*-npc.json`                       | Vanilla NPC FormID → display name. Used at import when a mod references an NPC it does not redefine.                    | Extracted from vanilla plugins via the GameDico NPC export set (see `src/formats/subrecords/gameReferenceLoader.ts`). |
| `src/resources/game-reference/*-race.json`, `fo4-keywords.json` | Same FormID → name shape (races; Fallout 4 KYWD editor IDs).                                                            | Same extraction family. **Not loaded by the app today.**                                                              |
| `src/resources/function-keywords/`                              | Papyrus / Creation Kit function and type names. Used to mask script tokens so the LLM does not “translate” identifiers. | Public script API identifiers from the CK / Papyrus docs for each game.                                               |
| `src/resources/glossary/`                                       | Curated English → Ukrainian term lists for prompts and `npm run db:seed:glossary`.                                      | Written for this project. Not an official localization STRING dump.                                                   |

If a rights holder objects to redistributing a specific dump, that file should move under gitignored `data/` and the loader should read it from there. Until then the metadata stays in git because first-run depends on it.
