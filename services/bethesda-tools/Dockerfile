FROM node:24-slim

RUN dpkg --add-architecture i386 \
  && apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    wine \
    wine32 \
    ffmpeg \
    curl \
    ca-certificates \
    unzip \
  && rm -rf /var/lib/apt/lists/*

# Always the latest GitHub release of thesydoruk/FaceFXWrapper.
RUN mkdir -p /opt/bethesda \
  && node --input-type=module -e '\
    const res = await fetch("https://api.github.com/repos/thesydoruk/FaceFXWrapper/releases/latest");\
    if (!res.ok) throw new Error(`GitHub latest: ${res.status}`);\
    const release = await res.json();\
    const asset = release.assets.find((row) => {\
      const name = String(row.name || "").toLowerCase();\
      return name.includes("facefxwrapper") && name.endsWith(".zip");\
    });\
    if (!asset) {\
      const names = (release.assets || []).map((row) => row.name).join(", ") || "(none)";\
      throw new Error(`no FaceFXWrapper zip on ${release.tag_name}: ${names}`);\
    }\
    const zip = await fetch(asset.browser_download_url);\
    if (!zip.ok) throw new Error(`download ${zip.status}`);\
    const { writeFileSync } = await import("node:fs");\
    writeFileSync("/tmp/FaceFXWrapper.zip", Buffer.from(await zip.arrayBuffer()));\
    process.stdout.write(`FaceFXWrapper ${release.tag_name}\\n`);\
  ' \
  && unzip -o /tmp/FaceFXWrapper.zip -d /tmp/facefx \
  && exe="$(find /tmp/facefx -name FaceFXWrapper.exe -print -quit)" \
  && test -n "$exe" \
  && mv "$exe" /opt/bethesda/FaceFXWrapper.exe \
  && rm -rf /tmp/FaceFXWrapper.zip /tmp/facefx

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY server.ts wineSlots.ts faceFxServe.ts ./

ENV NODE_ENV=production
ENV PORT=3210
ENV BETHESDA_TOOLS_DIR=/data/tools
ENV WINEPREFIX=/data/wine
ENV WINEARCH=win32
ENV WINEDEBUG=-all
ENV WINEDLLOVERRIDES=mscoree,mshtml=

EXPOSE 3210
CMD ["npx", "tsx", "server.ts"]
