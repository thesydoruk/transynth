# ── Stage 1: install backend dependencies ─────────────────────────────────────
FROM node:20-slim AS deps

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ── Stage 2: build web-ui (React SPA) ─────────────────────────────────────────
FROM node:20-slim AS ui-build

WORKDIR /app/web-ui

COPY web-ui/package.json web-ui/package-lock.json* ./
RUN npm ci

COPY web-ui/ ./
RUN npm run build

# ── Stage 3: production runtime ───────────────────────────────────────────────
FROM node:20-slim AS runtime

WORKDIR /app

# Backend dependencies (production only)
COPY --from=deps /app/node_modules ./node_modules

# Backend source
COPY package.json tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY sql/ ./sql/
COPY bin/ ./bin/

# Pre-built React SPA — served by Fastify static middleware
COPY --from=ui-build /app/web-ui/dist ./web-ui/dist/

ENV LLM_PROVIDER=ollama
ENV NODE_ENV=production

EXPOSE 3000

# Default: start the web server (API + SPA)
CMD ["node", "--import", "tsx/esm", "src/web/server.ts"]
