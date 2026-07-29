import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, resolveDir } from '../paths';
import { execFileAsync, type ExecFileResult } from '../utils/execFile';

export type WineArch = 'win32' | 'win64';

const wineReady = new Set<WineArch>();

const wineArchMarkerPath = (prefix: string): string => path.join(prefix, '.transynth-wine-arch');

const resetWinePrefix = (prefix: string): void => {
  if (fs.existsSync(prefix)) fs.rmSync(prefix, { recursive: true, force: true });
  fs.mkdirSync(prefix, { recursive: true });
};

const ensureWineReady = (arch: WineArch): void => {
  if (process.platform === 'win32') return;

  const prefix = resolveWinePrefix(arch);
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

  if (!fs.existsSync(prefix)) fs.mkdirSync(prefix, { recursive: true });
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
    // Without infinite persistence the server exits between tool runs and leaves its
    // service processes (services.exe, winedevice.exe, …) orphaned on every call.
    execFileSync(wineServerCommand(), ['-p'], { timeout: 30_000, stdio: 'ignore', env });
  } catch {
    // Older Wine builds without `wineserver -p` still work, just with more churn.
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
  if (useWine) ensureWineReady(arch);
  const execArgs = useWine ? wineifyArgs(args, env!) : args;
  return execFileAsync(command, [...argsPrefix, ...execArgs], { ...options, env });
};
