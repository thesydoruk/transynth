---
name: ai-pipeline
description: >-
  SSH to the ai-pipeline production server and operate the transynth Docker
  stack (deploy, logs, health, Wine tools). Use when the user mentions
  ai-pipeline, transynth deploy, production server, remote docker compose,
  or checking/fixing tools on the server.
---

# ai-pipeline (transynth production)

Production host for **transynth** (this repo). Do not confuse with **windows-ssh** (gaming PC / GPU / TTS).

| Setting     | Value                              |
| ----------- | ---------------------------------- |
| SSH alias   | `ai-pipeline`                      |
| User        | `root`                             |
| Hostname    | `ai-stuff`                         |
| Project dir | `~/Source/transynth`               |
| Web port    | **3200** → container `3000`        |
| Health      | `http://127.0.0.1:3200/api/health` |

Jump host: `router-kyiv`. Key: WSL `~/.ssh/id_rsa`. Key-only — no passwords.

## Connect (Windows → WSL → SSH)

**Always** run SSH through WSL. Never use `ssh` directly from PowerShell.

```bash
# One-off command
wsl -e bash -lc "ssh -o BatchMode=yes -o ConnectTimeout=10 ai-pipeline '<command>'"

# Interactive shell
wsl -e bash -lc "ssh ai-pipeline"
```

Health check — expect `ai-stuff`, user `root`, cwd `/root` or project path.

## Common operations

```bash
# Status + logs
wsl -e bash -lc "ssh -o BatchMode=yes ai-pipeline 'cd ~/Source/transynth && docker compose ps'"
wsl -e bash -lc "ssh -o BatchMode=yes ai-pipeline 'cd ~/Source/transynth && docker compose logs web --tail 50'"

# Rebuild & restart after code changes
wsl -e bash -lc "ssh -o BatchMode=yes ai-pipeline 'cd ~/Source/transynth && docker compose build web && docker compose up -d web'"

# Health from server
wsl -e bash -lc "ssh -o BatchMode=yes ai-pipeline 'curl -s http://127.0.0.1:3200/api/health'"
```

## Deploy updated code

From the dev machine (repo root), sync source and rebuild:

```bash
wsl -e bash -lc "rsync -avz --delete -e 'ssh -o BatchMode=yes' \
  /mnt/d/Source/fallout4-localization-project/src/ \
  ai-pipeline:~/Source/transynth/src/"

wsl -e bash -lc "rsync -avz -e 'ssh -o BatchMode=yes' \
  /mnt/d/Source/fallout4-localization-project/Dockerfile \
  /mnt/d/Source/fallout4-localization-project/docker-compose.yml \
  ai-pipeline:~/Source/transynth/"

wsl -e bash -lc "ssh -o BatchMode=yes ai-pipeline \
  'cd ~/Source/transynth && docker compose build web && docker compose up -d web'"
```

Adjust the `/mnt/d/Source/fallout4-localization-project/` path if the local repo lives elsewhere.

## One-shot container commands

Use when `web` is restarting or you need an isolated run:

```bash
wsl -e bash -lc "ssh -o BatchMode=yes ai-pipeline \
  'cd ~/Source/transynth && docker compose run --rm --no-deps -T --entrypoint node web --import tsx/esm <script>'"
```

CLI jobs (translate, tools:install, …):

```bash
wsl -e bash -lc "ssh -o BatchMode=yes ai-pipeline \
  'cd ~/Source/transynth && docker compose --profile tools run --rm cli npm run tools:install'"
```

## Wine / Bethesda tools

Tools live in `data/tools/` (mounted at `/app/data/tools`).

| Tool                      | Wine prefix       | Notes                                   |
| ------------------------- | ----------------- | --------------------------------------- |
| xWMAEncode, FaceFXWrapper | `.wine` (win32)   | Paths converted to `Z:\…` automatically |
| Champollion               | `.wine64` (win64) | 64-bit exe                              |

Verify after Docker/Wine changes (scripts in repo `scripts/`):

```bash
wsl -e bash -lc "ssh -o BatchMode=yes ai-pipeline \
  'cd ~/Source/transynth && docker compose run --rm --no-deps -T --entrypoint node web --import tsx/esm /app/data/verifyXwma.mjs'"
```

Copy verify scripts to server first if missing: `scp scripts/verify*.mjs ai-pipeline:~/Source/transynth/data/`

## Host roles (do not mix up)

| Alias           | Use for                                                       |
| --------------- | ------------------------------------------------------------- |
| **ai-pipeline** | transynth prod, PostgreSQL, `docker compose` for this project |
| **windows-ssh** | GPU, vLLM, TTS (`192.168.50.140:8080`), AI stacks             |

For DB admin on ai-pipeline: `scripts/killDbSessions.sh`.

## Agent checklist

1. Use WSL wrapper for every SSH/SCP/rsync command.
2. `cd ~/Source/transynth` before docker compose (not `fallout4-localization-project`).
3. Prefer `BatchMode=yes` and `ConnectTimeout=10`.
4. If a command fails with PowerShell parsing errors, simplify quoting or write a `.sh` script and scp it.
5. For tool issues, check `data/tools/` presence, then run verify scripts inside a one-shot container.

## Related files

- `.cursor/rules/test-server-ssh.mdc` — both hosts (ai-pipeline + windows-ssh)
- `docker-compose.yml` — production stack
- `scripts/verifyXwma.mjs`, `scripts/verifyFaceFx.mjs`, `scripts/verifyChampollion.mjs` — remote smoke tests
