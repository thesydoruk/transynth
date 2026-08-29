import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../logger';
import { PATHS, resolveDir } from '../paths';
import { execFileAsync, type ExecFileResult } from '../utils/execFile';
import { hintProcessGc } from '../utils/processGc';
import { ensureWinePrefixOwnedByCurrentUser } from './ensureWinePrefixOwner';

export type WineArch = 'win32' | 'win64';

/** FaceFX/xWMA rarely print more than a few KB; the default 64MB buffer inflates RSS. */
const WINE_TOOL_MAX_BUFFER = 1 * 1024 * 1024;

/** Restart wineserver after this many tool runs so persistent mode cannot grow forever. */
const parsedRecycleEvery = Number.parseInt(process.env.WINE_RECYCLE_EVERY_USES ?? '2000', 10);
const WINE_RECYCLE_EVERY_USES =
  Number.isFinite(parsedRecycleEvery) && parsedRecycleEvery > 0 ? parsedRecycleEvery : 2000;

const wineReady = new Set<WineArch>();
let wineJobDepth = 0;
let wineInFlight = 0;
let wineUsesSinceRecycle = 0;

const wineArchMarkerPath = (prefix: string): string => path.join(prefix, '.transynth-wine-arch');

const resetWinePrefix = (prefix: string): void => {
  if (fs.existsSync(prefix)) fs.rmSync(prefix, { recursive: true, force: true });
  fs.mkdirSync(prefix, { recursive: true });
};

const killWineServer = (arch: WineArch): void => {
  try {
    execFileSync(wineServerCommand(), ['-k'], {
      timeout: 10_000,
      stdio: 'ignore',
      env: wineProcessEnv(arch),
    });
  } catch {
    // No wineserver for this prefix.
  }
};

const ensureWineReady = (arch: WineArch): void => {
  if (process.platform === 'win32') return;

  const prefix = resolveWinePrefix(arch);
  if (!fs.existsSync(prefix)) fs.mkdirSync(prefix, { recursive: true });
  if (ensureWinePrefixOwnedByCurrentUser(prefix)) {
    killWineServer(arch);
    wineReady.delete(arch);
  }

  const marker = wineArchMarkerPath(prefix);
  const markedArch = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : null;
  if (markedArch && markedArch !== arch) {
    resetWinePrefix(prefix);
    wineReady.delete(arch);
  } else if (!markedArch && fs.existsSync(path.join(prefix, 'system.reg'))) {
    // Prefix from a previous run without arch tracking (or wrong WINEARCH).
    resetWinePrefix(prefix);
    wineReady.delete(arch);
  }

  if (wineReady.has(arch)) return;
  wineReady.add(arch);

  const env = wineProcessEnv(arch);
  try {
    execFileSync(wineCommand(), ['wineboot', '--init'], {
      timeout: 120_000,
      stdio: 'ignore',
      env,
    });
    fs.writeFileSync(marker, `${arch}\n`, 'utf8');
  } catch {
    // First-run prefix creation can fail in restricted environments; tools may still work.
  }

  try {
    // Persist during a job so services.exe is not re-spawned (and orphaned) per .exe.
    // `shutdownWine` / recycle drop it again so RSS does not stick after synthesis.
    execFileSync(wineServerCommand(), ['-p'], { timeout: 30_000, stdio: 'ignore', env });
  } catch {
    // Older Wine builds without `wineserver -p` still work, just with more churn.
  }
};

/** Kill both prefixes and forget the in-process "ready" flag. */
export const shutdownWine = (): void => {
  if (process.platform === 'win32') return;
  killWineServer('win32');
  killWineServer('win64');
  wineReady.clear();
  wineInFlight = 0;
  wineUsesSinceRecycle = 0;
};

const maybeRecycleIdleWine = (): void => {
  if (wineInFlight !== 0) return;
  if (wineUsesSinceRecycle < WINE_RECYCLE_EVERY_USES) return;
  log.info(`Recycling Wine after ${wineUsesSinceRecycle} tool runs`);
  shutdownWine();
};

const beginWineUse = (arch: WineArch): void => {
  maybeRecycleIdleWine();
  ensureWineReady(arch);
  wineInFlight += 1;
};

const endWineUse = (): void => {
  wineInFlight = Math.max(0, wineInFlight - 1);
  wineUsesSinceRecycle += 1;
  maybeRecycleIdleWine();
};

/**
 * Keep wineserver alive for nested Wine work, then kill it and hint GC when
 * the outermost job finishes (safe with concurrent voice jobs).
 */
export const withWineJob = async <T>(fn: () => Promise<T>): Promise<T> => {
  wineJobDepth += 1;
  try {
    return await fn();
  } finally {
    wineJobDepth -= 1;
    if (wineJobDepth === 0) {
      shutdownWine();
      hintProcessGc();
    }
  }
};

export const wineCommand = (): string => process.env.WINE_PATH?.trim() || 'wine';

export const wineServerCommand = (): string => process.env.WINESERVER_PATH?.trim() || 'wineserver';

/** 32-bit prefix for voice tools; override with `WINEPREFIX`. */
export const resolveWinePrefix = (arch: WineArch = 'win32'): string => {
  if (arch === 'win64') {
    return resolveDir(process.env.WINEPREFIX64?.trim() || path.join(PATHS.toolsDir, '.wine64'));
  }
  return resolveDir(process.env.WINEPREFIX?.trim() || path.join(PATHS.toolsDir, '.wine'));
};

export const wineProcessEnv = (arch: WineArch): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  env.WINEPREFIX = resolveWinePrefix(arch);
  env.WINEARCH = arch;
  return env;
};

export const isWineExePath = (toolPath: string): boolean => /\.exe$/i.test(path.resolve(toolPath));

/** Map a Windows `.exe` to `wine` + exe on Linux; run natively on Windows. */
export const resolveWindowsExecutable = (
  toolPath: string,
): { command: string; argsPrefix: string[] } => {
  const resolved = path.resolve(toolPath);
  if (process.platform === 'win32' || !isWineExePath(resolved)) {
    return { command: resolved, argsPrefix: [] };
  }
  return { command: wineCommand(), argsPrefix: [resolved] };
};

export const isWineAvailable = (): boolean => {
  if (process.platform === 'win32') return true;
  try {
    execFileSync(wineCommand(), ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

/** Convert a Unix path to a `Z:\…` path for Wine Windows tools. */
export const toWinePath = (unixPath: string, env: NodeJS.ProcessEnv): string => {
  if (process.platform === 'win32') return path.resolve(unixPath);
  try {
    return execFileSync('winepath', ['-w', path.resolve(unixPath)], {
      encoding: 'utf8',
      env,
    }).trim();
  } catch {
    return path.resolve(unixPath);
  }
};

export const looksLikeUnixPathArg = (arg: string): boolean => {
  if (!arg || arg.startsWith('-')) return false;
  if (arg.startsWith('/') || arg.startsWith('./') || arg.startsWith('../')) return true;
  if (arg.includes('/') && !arg.includes(' ')) return true;
  return false;
};

/** Rewrite file-path CLI args to Wine `Z:\` paths on Linux. */
export const wineifyArgs = (args: string[], env: NodeJS.ProcessEnv): string[] => {
  if (process.platform === 'win32') return args;
  return args.map((arg) => (looksLikeUnixPathArg(arg) ? toWinePath(arg, env) : arg));
};

/** Run a Windows `.exe` (or native wrapper) via `execFile`, with Wine on Linux. */
export const execWindowsToolAsync = async (
  toolPath: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; arch?: WineArch } = {},
): Promise<ExecFileResult> => {
  const arch = options.arch ?? 'win32';
  const { command, argsPrefix } = resolveWindowsExecutable(toolPath);
  const useWine = isWineExePath(toolPath) && process.platform !== 'win32';
  const env = useWine ? wineProcessEnv(arch) : undefined;
  if (useWine) beginWineUse(arch);
  const execArgs = useWine ? wineifyArgs(args, env!) : args;
  try {
    return await execFileAsync(command, [...argsPrefix, ...execArgs], {
      ...options,
      env,
      maxBuffer: WINE_TOOL_MAX_BUFFER,
    });
  } finally {
    if (useWine) endWineUse();
  }
};
