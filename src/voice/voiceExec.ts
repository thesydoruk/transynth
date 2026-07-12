import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../paths';
import { execFileAsync, type ExecFileResult } from '../utils/execFile';

let wineReady = false;

export const wineCommand = (): string => process.env.WINE_PATH?.trim() || 'wine';

/** Wine prefix under `DATA_DIR/tools/.wine` unless `WINEPREFIX` is set. */
export const resolveWinePrefix = (): string =>
  path.resolve(process.env.WINEPREFIX?.trim() || path.join(PATHS.toolsDir, '.wine'));

const wineProcessEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  env.WINEPREFIX = resolveWinePrefix();
  return env;
};

export const isWineExePath = (toolPath: string): boolean => /\.exe$/i.test(path.resolve(toolPath));

/** Map a voice tool path to the process + leading args (`wine` + `.exe` on Linux). */
export const resolveVoiceExecutable = (
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

const ensureWineReady = (): void => {
  if (wineReady || process.platform === 'win32') return;
  wineReady = true;
  const prefix = resolveWinePrefix();
  fs.mkdirSync(prefix, { recursive: true });
  try {
    execFileSync(wineCommand(), ['wineboot', '--init'], {
      timeout: 120_000,
      stdio: 'ignore',
      env: wineProcessEnv(),
    });
  } catch {
    // First-run prefix creation can fail in restricted environments; encoding may still work.
  }
};

/** Run a Bethesda voice `.exe` (or native wrapper script) via `execFile`. */
export const execVoiceToolAsync = async (
  toolPath: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<ExecFileResult> => {
  const { command, argsPrefix } = resolveVoiceExecutable(toolPath);
  const env =
    isWineExePath(toolPath) && process.platform !== 'win32' ? wineProcessEnv() : undefined;
  if (env) ensureWineReady();
  return execFileAsync(command, [...argsPrefix, ...args], { ...options, env });
};
