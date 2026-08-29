# ── Stage 1: install backend dependencies ─────────────────────────────────────
FROM node:24-slim AS deps

WORKDIR /app

COPY package.json package-lock.json* ./
ENV HUSKY=0
# --ignore-scripts skips postinstall; 7z npm packages ship binaries without +x.
RUN npm ci --omit=dev --ignore-scripts \
  && chmod +x node_modules/7zip-bin/linux/x64/7za \
  && chmod +x node_modules/7z-bin/bin/linux/x64/7zzs

# ── Stage 2: build web-ui (React SPA) ─────────────────────────────────────────
FROM node:24-slim AS ui-build

WORKDIR /app/web-ui

COPY web-ui/package.json web-ui/package-lock.json* ./
RUN npm ci

COPY web-ui/ ./
RUN npm run build

# ── Stage 3: production runtime ───────────────────────────────────────────────
FROM node:24-slim AS runtime

# Wine for Bethesda voice tools (32-bit) and Champollion (64-bit)
RUN dpkg --add-architecture i386 \
  && apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    wine \
    wine32 \
    wine64 \
    ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Backend dependencies (production only)
COPY --from=deps /app/node_modules ./node_modules

# Backend source
COPY package.json tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY sql/ ./sql/

# Worker package (own package.json, like web-ui; shares ../src business logic)
COPY worker/package.json worker/package-lock.json* ./worker/
RUN cd worker && npm ci --omit=dev --ignore-scripts
COPY worker/src ./worker/src/
COPY worker/tsconfig.json ./worker/

# Pre-built React SPA — served by Fastify static middleware
COPY --from=ui-build /app/web-ui/dist ./web-ui/dist/

ENV LLM_PROVIDER=vllm
ENV NODE_ENV=production
ENV WINEARCH=win32
ENV WINEPREFIX=/app/data/tools/.wine
ENV WINEPREFIX64=/app/data/tools/.wine64
ENV WINEDLLOVERRIDES=mscoree,mshtml=
ENV WINEDEBUG=-all

EXPOSE 3000

# Default: start the web server (API + SPA)
CMD ["node", "--import", "tsx/esm", "src/web/server.ts"]
