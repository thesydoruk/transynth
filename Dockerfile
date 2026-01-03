# Stage 1: install dependencies (needs Python for native better-sqlite3 build)
FROM node:20-slim AS deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# Stage 2: final image without build tools
FROM node:20-slim AS runtime

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY sql/ ./sql/
COPY xedit/ ./xedit/
COPY bin/ ./bin/

# Data dir (sqlite db, csv exports)
RUN mkdir -p /data
VOLUME ["/data"]

ENV DATABASE_PATH=/data/localizer.sqlite
ENV LLM_PROVIDER=ollama

ENTRYPOINT ["node", "--import", "tsx/esm"]
