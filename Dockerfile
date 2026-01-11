# Stage 1: install dependencies
FROM node:20-slim AS deps

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# Stage 2: final image
FROM node:20-slim AS runtime

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY sql/ ./sql/
COPY xedit/ ./xedit/
COPY bin/ ./bin/

ENV LLM_PROVIDER=ollama

ENTRYPOINT ["node", "--import", "tsx/esm"]
