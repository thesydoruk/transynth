# ── Stage 1: install backend dependencies ─────────────────────────────────────
FROM node:24-slim AS deps

WORKDIR /app

COPY package.json package-lock.json* ./
ENV HUSKY=0
# --ignore-scripts skips postinstall; 7z npm packages ship binaries without +x.
RUN npm ci --omit=dev --ignore-scripts \
  && chmod +x node_modules/7zip-bin/linux/x64/7za \
  && chmod +x node_modules/7z-bin/bin/linux/x64/7zzs

# ── Stage 2: native Champollion (cloned from GitHub at image build) ───────────
FROM node:24-slim AS champollion

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    cmake \
    g++ \
    make \
    libboost-program-options-dev \
    libfmt-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 --branch main https://github.com/thesydoruk/linux-champollion.git . \
  && cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
  && cmake --build build -j"$(nproc)" \
  && install -D build/Champollion/Champollion /out/Champollion \
  && mkdir -p /out/lib \
  && ldd /out/Champollion \
    | awk '/=>/ && ($3 ~ /libboost_program_options/ || $3 ~ /libfmt/) { print $3 }' \
    | xargs -r -I{} cp -L {} /out/lib/ \
  && touch /out/lib/.keep

# ── Stage 3: build web-ui (React SPA) ─────────────────────────────────────────
FROM node:24-slim AS ui-build

WORKDIR /app/web-ui

COPY web-ui/package.json web-ui/package-lock.json* ./
RUN npm ci

COPY web-ui/ ./
RUN npm run build

# ── Stage 4: production runtime ───────────────────────────────────────────────
FROM node:24-slim AS runtime

# ffmpeg for voice WAV prep. FaceFX / xWMA run in bethesda-tools. Champollion is native.
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY --from=champollion /out/Champollion /usr/local/bin/Champollion
COPY --from=champollion /out/lib/ /usr/local/lib/champollion/

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
ENV LD_LIBRARY_PATH=/usr/local/lib/champollion

EXPOSE 3000

# Default: start the web server (API + SPA)
CMD ["node", "--import", "tsx/esm", "src/web/server.ts"]
