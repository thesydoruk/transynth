/**
 * Wine 32-bit Bethesda tools: FaceFX LIP and xWMAEncode.
 *
 * One FaceFX/xWMA job per wineserver by default. Scale with
 * BETHESDA_TOOLS_WINE_SERVERS (separate prefixes).
 *
 * FaceFXWrapper `serve` keeps CK mapped on each prefix.
 *
 * POST /v1/lip  { game?, text, wav }  → raw .lip
 * POST /v1/xwm  { wav }               → raw .xwm
 * POST /v1/ffxanim  { text, wav, actor, name?, game? } → raw Starfield .ffxanim
 *                   (the Starfield Creation Kit's LipGenerator + ffxc, user-supplied,
 *                   under 64-bit Wine; see ffxanimRoute.ts)
 * POST /v1/binkmix  multipart trackIds, video, sound → the Bink 2 video with the
 *                   sound on every listed track (radvideo64.exe under 64-bit Wine)
 * GET  /health
 */
import { execFile } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createBinkMixHandler } from './binkMixRoute';
import { createFaceFxServePool } from './faceFxServe';
import { wineToolRunner } from './ffxanim';
import { createStarfieldLipService } from './ffxanimRoute';
import { decodeWav, readJsonBody, sendBytes, sendJson } from './http';
import { createStarfieldToolsCache } from './starfieldTools';
import {
  createWineSlotPool,
  migrateLegacyWinePrefix,
  parsePerWine,
  parseWineServerCount,
  toWinePath,
  type WineSlot,
} from './wineSlots';

const execFileAsync = promisify(execFile);

const PORT = Number.parseInt(process.env.PORT ?? '3210', 10);
const WINE_SERVERS = parseWineServerCount(process.env.BETHESDA_TOOLS_WINE_SERVERS);
const PER_WINE = parsePerWine(process.env.BETHESDA_TOOLS_PER_WINE);
const TIMEOUT_MS = Number.parseInt(process.env.BETHESDA_TOOLS_TIMEOUT_MS ?? '120000', 10);
const TOOLS_DIR = process.env.BETHESDA_TOOLS_DIR ?? '/data/tools';
const WINEPREFIX_ROOT = process.env.WINEPREFIX ?? '/data/wine';
const WINE = process.env.WINE_PATH ?? 'wine';
const WINESERVER = process.env.WINESERVER_PATH ?? 'wineserver';
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FACEFX_EXE = '/opt/bethesda/FaceFXWrapper.exe';
const RADVIDEO_EXE = process.env.RADVIDEO_PATH ?? '/opt/bethesda/radvideo64.exe';
const FONIX = process.env.FONIX_DATA_PATH ?? path.join(TOOLS_DIR, 'FonixData.cdf');
/** Baked into the image from the DirectX SDK; a copy mounted with Fonix still wins the env. */
const XWMA_EXE =
  process.env.XWMA_ENCODE_PATH ??
  (fs.existsSync('/opt/bethesda/xWMAEncode.exe')
    ? '/opt/bethesda/xWMAEncode.exe'
    : path.join(TOOLS_DIR, 'xWMAEncode.exe'));

const faceFxGameType = (game: string): string => {
  switch (game) {
    case 'fo4':
    case 'fo76':
      return 'Fallout4';
    case 'fo3':
      return 'Fallout3';
    case 'fnv':
      return 'FalloutNV';
    default:
      return 'Skyrim';
  }
};

const wineEnv = (prefix: string, arch: 'win32' | 'win64' = 'win32'): NodeJS.ProcessEnv => ({
  ...process.env,
  WINEPREFIX: prefix,
  WINEARCH: arch,
  WINEDEBUG: '-all',
  WINEDLLOVERRIDES: 'mscoree,mshtml=',
});

/** radvideo64.exe is 64-bit only: its own win64 prefix beside the 32-bit pool. */
const BINK_PREFIX = path.join(WINEPREFIX_ROOT, 'bink64');
const binkMix = createBinkMixHandler({
  wine: WINE,
  exe: RADVIDEO_EXE,
  env: wineEnv(BINK_PREFIX, 'win64'),
  // A pass takes seconds (3.5 s per track on Fallout 4's intro); a pass that has not
  // returned in minutes is a dialog waiting for a click, and the caller retries.
  timeoutMs: Number.parseInt(process.env.BETHESDA_TOOLS_BINK_TIMEOUT_MS ?? '300000', 10),
});

const pool = createWineSlotPool(WINEPREFIX_ROOT, WINE_SERVERS, PER_WINE);
const totalSlots = WINE_SERVERS * PER_WINE;
const servePool = createFaceFxServePool({
  wine: WINE,
  exe: FACEFX_EXE,
  wineEnv,
  readyTimeoutMs: Math.max(TIMEOUT_MS, 180_000),
  jobTimeoutMs: TIMEOUT_MS,
});

/** Starfield `.ffxanim`: user-supplied tools from `<tools>/starfield/`, run from a local copy. */
const starfield = createStarfieldLipService({
  tools: createStarfieldToolsCache(
    path.join(TOOLS_DIR, 'starfield'),
    path.join(os.tmpdir(), 'bethesda-tools-starfield'),
  ),
  prefixRoot: path.join(WINEPREFIX_ROOT, 'ffx64'),
  concurrency: totalSlots,
  runner: (prefix) => wineToolRunner(WINE, wineEnv(prefix, 'win64')),
  initPrefix: (prefix) => initWinePrefix(prefix, 'win64'),
  toolPath: toWinePath,
  timeoutMs: TIMEOUT_MS,
});

const toolStatus = (): {
  facefx: boolean;
  fonix: boolean;
  xwma: boolean;
  bink: boolean;
  starfield: boolean;
} => ({
  facefx: fs.existsSync(FACEFX_EXE),
  fonix: fs.existsSync(FONIX),
  xwma: fs.existsSync(XWMA_EXE),
  bink: fs.existsSync(RADVIDEO_EXE),
  // Optional: absent Starfield tools fail only /v1/ffxanim, never the health check.
  starfield: starfield.installed(),
});

const initWinePrefix = async (prefix: string, arch: 'win32' | 'win64' = 'win32'): Promise<void> => {
  if (!fs.existsSync(prefix)) fs.mkdirSync(prefix, { recursive: true });
  const env = wineEnv(prefix, arch);
  if (!fs.existsSync(path.join(prefix, 'system.reg'))) {
    try {
      await execFileAsync(WINE, ['wineboot', '--init'], { env, timeout: 120_000 });
    } catch {
      // Prefix may still be usable after a noisy first wineboot.
    }
  }
  try {
    await execFileAsync(WINESERVER, ['-p'], { env, timeout: 30_000 });
  } catch {
    // Older Wine builds without `wineserver -p` still start a server per job.
  }
};

const ensureWinePrefixes = async (): Promise<void> => {
  if (!fs.existsSync(WINEPREFIX_ROOT)) fs.mkdirSync(WINEPREFIX_ROOT, { recursive: true });
  migrateLegacyWinePrefix(WINEPREFIX_ROOT);
  await Promise.all([
    ...pool.slots.map((slot) => initWinePrefix(slot.prefix)),
    initWinePrefix(BINK_PREFIX, 'win64'),
  ]);
};

const resampleFaceFxWav = async (wavBytes: Buffer, work: string): Promise<string> => {
  const srcWav = path.join(work, 'in.wav');
  const resampled = path.join(work, 'fx.wav');
  fs.writeFileSync(srcWav, wavBytes);
  await execFileAsync(
    FFMPEG,
    ['-y', '-i', srcWav, '-ac', '1', '-ar', '16000', '-sample_fmt', 's16', resampled],
    { timeout: 30_000 },
  );
  return resampled;
};

const runLipOnSlot = async (
  slot: WineSlot,
  game: string,
  text: string,
  resampled: string,
  lipPath: string,
): Promise<Buffer> => {
  const gameType = faceFxGameType(game);
  await servePool.runLip(slot.prefix, gameType, {
    language: /[\u0400-\u04FF]/.test(text) ? 'Ukrainian' : 'USEnglish',
    fonixWinPath: toWinePath(FONIX),
    wavWinPath: toWinePath(resampled),
    lipWinPath: toWinePath(lipPath),
    text,
  });
  if (!fs.existsSync(lipPath) || fs.statSync(lipPath).size === 0) {
    throw new Error('FaceFX wrote no LIP');
  }
  return fs.readFileSync(lipPath);
};

const runXwmOnSlot = async (slot: WineSlot, wavBytes: Buffer): Promise<Buffer> => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bethesda-xwm-'));
  const wavPath = path.join(work, 'in.wav');
  const xwmPath = path.join(work, 'out.xwm');
  try {
    fs.writeFileSync(wavPath, wavBytes);
    await execFileAsync(WINE, [XWMA_EXE, '-b', '48000', toWinePath(wavPath), toWinePath(xwmPath)], {
      env: wineEnv(slot.prefix),
      timeout: TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    if (!fs.existsSync(xwmPath) || fs.statSync(xwmPath).size === 0) {
      throw new Error('xWMAEncode wrote no XWM');
    }
    return fs.readFileSync(xwmPath);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
};

const withWineSlot = async (
  res: ServerResponse,
  work: (slot: WineSlot) => Promise<Buffer>,
): Promise<void> => {
  const slot = await pool.acquire();
  try {
    sendBytes(res, await work(slot));
  } finally {
    pool.release(slot);
  }
};

const handleLip = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = (await readJsonBody(req)) as { game?: string; text?: string; wav?: string };
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const wav = decodeWav(body.wav);
  if (!text || !wav) {
    sendJson(res, 400, { ok: false, error: 'text and wav (base64) are required' });
    return;
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bethesda-lip-'));
  const lipPath = path.join(work, 'out.lip');
  try {
    const resampled = await resampleFaceFxWav(wav, work);
    await withWineSlot(res, (slot) =>
      runLipOnSlot(slot, body.game ?? 'fo4', text, resampled, lipPath),
    );
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
};

const handleXwm = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = (await readJsonBody(req)) as { wav?: string };
  const wav = decodeWav(body.wav);
  if (!wav) {
    sendJson(res, 400, { ok: false, error: 'wav (base64) is required' });
    return;
  }
  await withWineSlot(res, (slot) => runXwmOnSlot(slot, wav));
};

const server = createServer((req, res) => {
  const url = req.url ?? '/';
  if (req.method === 'GET' && (url === '/health' || url === '/')) {
    const tools = toolStatus();
    const facefxServe = servePool.snapshot();
    const ok =
      tools.facefx && tools.fonix && tools.xwma && tools.bink && facefxServe.mode === 'serve';
    sendJson(res, ok ? 200 : 503, {
      ok,
      service: 'bethesda-tools',
      active: pool.activeCount(),
      wineServers: WINE_SERVERS,
      perWine: PER_WINE,
      concurrency: totalSlots,
      facefxServe,
      slots: pool.snapshot().map(({ id, active, assigned }) => ({ id, active, assigned })),
      ffxanim: starfield.snapshot(),
      tools,
    });
    return;
  }

  const fail = (err: unknown): void => {
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: message });
    else res.destroy();
  };

  if (req.method === 'POST' && url === '/v1/lip') {
    handleLip(req, res).catch(fail);
    return;
  }
  if (req.method === 'POST' && url === '/v1/xwm') {
    handleXwm(req, res).catch(fail);
    return;
  }
  if (req.method === 'POST' && url === '/v1/ffxanim') {
    starfield.handle(req, res).catch(fail);
    return;
  }
  if (req.method === 'POST' && url === '/v1/binkmix') {
    binkMix(req, res).catch(fail);
    return;
  }
  sendJson(res, 404, { ok: false, error: 'not found' });
});

await ensureWinePrefixes();
const stop = (): void => {
  servePool.shutdown();
  server.close();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

server.listen(PORT, '0.0.0.0', () => {
  const tools = toolStatus();
  process.stdout.write(
    `bethesda-tools listening on :${PORT} wineServers=${WINE_SERVERS} perWine=${PER_WINE} ` +
      `facefx=${tools.facefx} xwma=${tools.xwma} bink=${tools.bink} starfield=${tools.starfield}\n`,
  );
  // Starfield tools present: copy them and boot their prefix before the first take.
  if (tools.starfield) {
    void starfield
      .warm()
      .then(() => process.stdout.write('bethesda-tools starfield tools ready\n'))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        process.stdout.write(`bethesda-tools starfield warm-up failed: ${message}\n`);
      });
  }
  void servePool
    .warm(
      pool.slots.map((slot) => slot.prefix),
      'Fallout4',
    )
    .then(() => {
      process.stdout.write(`bethesda-tools facefxServe=${servePool.mode}\n`);
    })
    // A FaceFX that cannot start leaves /health at 503; it must not take the process
    // (and /v1/xwm, /v1/ffxanim, /v1/binkmix) down with an unhandled rejection.
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(`bethesda-tools facefxServe failed: ${message}\n`);
    });
});
