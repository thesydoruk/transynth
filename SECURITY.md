# Security

Transynth is a **self-hosted, single-operator** tool. There are **no user accounts** and **no login**. A built-in default user exists only so the activity log has someone to attribute actions to.

Anyone who can reach the HTTP port can import and delete mods, change project settings, spend LLM/TTS budget, reindex RAG, and read logs. Treat the process like a local app, not a multi-tenant service.

## Bind address

- Unset `HOST` binds **127.0.0.1** only (`src/web/server.ts`).
- `npm run` / `tsx` on a laptop stay on loopback unless you set `HOST`.
- Docker Compose sets `HOST=0.0.0.0` **inside the container** so `ports:` works. The published `WEB_PORT` is then reachable on every host interface Docker binds (default: all of them).
- To keep Docker on this machine only: publish `127.0.0.1:${WEB_PORT}:${PORT}` instead of `${WEB_PORT}:${PORT}`.

## Do not put this on the public internet

Put TLS and a reverse proxy in front if you must expose it beyond your LAN. Optional application `AUTH_TOKEN` is **not implemented**. CORS is `origin: true` because the Vite dev UI is on another port; that is not an access-control boundary.

This is a **trusted LAN** (or localhost) app, not multi-tenant. There is no Helmet, no HTTP rate limit, and no application login. Anyone on the published port is the operator.

## Uploads

Unset `UPLOAD_MAX_FILE_SIZE_MB` means no practical application-level cap. Set it (megabytes) if you want a limit.

## LLM endpoints

`PUT /api/project-settings/llm.vllm_servers` stores hosts that the **server** will call (health checks, chat, embeddings). Only `http://` and `https://` URLs are accepted. Private/LAN addresses are allowed on purpose. Do not point this at a host you do not trust.

## Redis

Compose Redis has **no password** and **no host port**. It is reachable only on the project network (`redis://redis:6379`). `REDIS_URL` can include a password if you add `--requirepass` yourself. Do not publish `6379` to the LAN.

## What this file is not

A promise of hardened multi-user security. If you need that, terminate TLS and authenticate at the proxy.
