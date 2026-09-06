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
 * GET  /health
 */
import { execFile } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createFaceFxServePool } from './faceFxServe';
import {
  createWineSlotPool,
  migrateLegacyWinePrefix,
  parsePerWine,
  parseWineServerCount,
  type WineSlot,
} from './wineSlots';

const execFileAsync = promisify(execFile);

const PORT = Number.parseInt(process.env.PORT ?? '3210', 10);
const WINE_SERVERS = parseWineServerCount(process.env.BETHESDA_TOOLS_WINE_SERVERS);
const PER_WINE = parsePerWine(process.env.BETHESDA_TOOLS_PER_WINE);
const TIMEOUT_MS = Number.parseInt(process.env.BETHESDA_TOOLS_TIMEOUT_MS ?? '120000', 10);
const MAX_BODY = 32 * 1024 * 1024;
const TOOLS_DIR = process.env.BETHESDA_TOOLS_DIR ?? '/data/tools';
const WINEPREFIX_ROOT = process.env.WINEPREFIX ?? '/data/wine';
const WINE = process.env.WINE_PATH ?? 'wine';
const WINESERVER = process.env.WINESERVER_PATH ?? 'wineserver';
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FACEFX_EXE = '/opt/bethesda/FaceFXWrapper.exe';
const FONIX = process.env.FONIX_DATA_PATH ?? path.join(TOOLS_DIR, 'FonixData.cdf');
const XWMA_EXE = process.env.XWMA_ENCODE_PATH ?? path.join(TOOLS_DIR, 'xWMAEncode.exe');

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

const wineEnv = (prefix: string): NodeJS.ProcessEnv => ({
  ...process.env,
  WINEPREFIX: prefix,
  WINEARCH: 'win32',
  WINEDEBUG: '-all',
  WINEDLLOVERRIDES: 'mscoree,mshtml=',
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

const readJsonBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY) throw new Error('body too large');
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw) as unknown;
};

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
};

const sendBytes = (res: ServerResponse, data: Buffer): void => {
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': data.length,
  });
  res.end(data);
};

const decodeWav = (wavB64: unknown): Buffer | null => {
  if (typeof wavB64 !== 'string' || !wavB64) return null;
  try {
    const wav = Buffer.from(wavB64, 'base64');
    return wav.length >= 16 ? wav : null;
  } catch {
    return null;
  }
};

const toolStatus = (): { facefx: boolean; fonix: boolean; xwma: boolean } => ({
  facefx: fs.existsSync(FACEFX_EXE),
  fonix: fs.existsSync(FONIX),
  xwma: fs.existsSync(XWMA_EXE),
});

/** Wine maps `/` to `Z:`; the .exe tools want Windows paths in argv. */
const toWinePath = (unixPath: string): string => `Z:${path.resolve(unixPath).replace(/\//g, '\\')}`;

const initWinePrefix = async (prefix: string): Promise<void> => {
  if (!fs.existsSync(prefix)) fs.mkdirSync(prefix, { recursive: true });
  const env = wineEnv(prefix);
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
  await Promise.all(pool.slots.map((slot) => initWinePrefix(slot.prefix)));
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
    language: 'USEnglish',
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
    const ok = tools.facefx && tools.fonix && tools.xwma && facefxServe.mode === 'serve';
    sendJson(res, ok ? 200 : 503, {
      ok,
      service: 'bethesda-tools',
      active: pool.activeCount(),
      wineServers: WINE_SERVERS,
      perWine: PER_WINE,
      concurrency: totalSlots,
      facefxServe,
      slots: pool.snapshot().map(({ id, active, assigned }) => ({ id, active, assigned })),
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
      `facefx=${tools.facefx} xwma=${tools.xwma}\n`,
  );
  void servePool
    .warm(
      pool.slots.map((slot) => slot.prefix),
      'Fallout4',
    )
    .then(() => {
      process.stdout.write(`bethesda-tools facefxServe=${servePool.mode}\n`);
    });
});
