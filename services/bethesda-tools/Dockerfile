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
    p7zip-full \
  && rm -rf /var/lib/apt/lists/*

# Always the latest GitHub release of thesydoruk/FaceFXWrapper.
# Release zips are built on Windows with `\` separators: unzip still extracts
# them but exits 1 ("warning"), so 1 is accepted and the find below checks.
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
  && { unzip -o /tmp/FaceFXWrapper.zip -d /tmp/facefx || [ $? -eq 1 ]; } \
  && exe="$(find /tmp/facefx -name FaceFXWrapper.exe -print -quit)" \
  && test -n "$exe" \
  && mv "$exe" /opt/bethesda/FaceFXWrapper.exe \
  && rm -rf /tmp/FaceFXWrapper.zip /tmp/facefx

# xWMAEncode.exe from the Microsoft DirectX SDK (June 2010). Microsoft's download
# URL went 404 in 2026; the Internet Archive keeps the same installer (599 MB), which
# 7-Zip opens as a cabinet, so only the one file is pulled out. The installer's
# checksum pins what the build accepts.
ARG DXSDK_URL=https://archive.org/download/dxsdk_jun10/DXSDK_Jun10.exe
ARG DXSDK_SHA256=9f818a977c32b254af5d649a4cec269ed8762f8a49ae67a9f01101a7237ae61a
RUN curl -fsSL --retry 3 -o /tmp/DXSDK_Jun10.exe "$DXSDK_URL" \
  && echo "$DXSDK_SHA256  /tmp/DXSDK_Jun10.exe" | sha256sum -c - \
  && 7z e -y -o/opt/bethesda /tmp/DXSDK_Jun10.exe DXSDK/Utilities/bin/x86/xWMAEncode.exe >/dev/null \
  && test -s /opt/bethesda/xWMAEncode.exe \
  && rm -f /tmp/DXSDK_Jun10.exe

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
