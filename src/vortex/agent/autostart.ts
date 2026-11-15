/**
 * Start the agent when the user signs in to Windows: a launcher in the user's
 * own Startup folder. No scheduled task and no administrator rights; deleting
 * the file turns it off. The launcher reopens itself minimised, starts the
 * agent from the clone it was written for and starts it again after a crash —
 * not after a stop, which exits with 0.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultConfigPath } from './config';

export type AutostartTarget = {
  /** The clone the agent runs from. */
  repoRoot: string;
  /** The config the agent was started with; named in the launcher when not the default. */
  configPath: string;
};

export type AutostartStatus = { supported: boolean; enabled: boolean; file: string };

export const autostartFile = (env: NodeJS.ProcessEnv = process.env): string =>
  path.join(
    env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
    'Transynth Vortex agent.cmd',
  );

/** A path inside a quoted batch argument: `%` would start a variable. */
const batchPath = (value: string): string => value.replace(/%/g, '%%');

export const autostartScript = (target: AutostartTarget): string => {
  for (const value of [target.repoRoot, target.configPath]) {
    if (/["\r\n]/.test(value)) throw new Error(`Cannot write a launcher for the path ${value}`);
  }
  const custom = path.resolve(target.configPath) !== path.resolve(defaultConfigPath());
  const run = `call npm.cmd run vortex:agent${custom ? ` -- --config "${batchPath(target.configPath)}"` : ''}`;
  return [
    '@echo off',
    'rem Written by the Transynth Vortex agent page (autostart). Delete this file to turn it off.',
    'if not "%~1"=="run" (',
    '  start "Transynth Vortex agent" /min "%~f0" run',
    '  exit /b',
    ')',
    `cd /d "${batchPath(target.repoRoot)}"`,
    ':again',
    run,
    // Not `if errorlevel 1`: a failed npm can exit with a negative code.
    'if %errorlevel% neq 0 (',
    '  timeout /t 30 /nobreak >nul',
    '  goto again',
    ')',
    '',
  ].join('\r\n');
};

export const readAutostart = (
  file = autostartFile(),
  platform: NodeJS.Platform = process.platform,
): AutostartStatus => ({
  supported: platform === 'win32',
  enabled: platform === 'win32' && fs.existsSync(file),
  file,
});

export const setAutostart = (
  enabled: boolean,
  target: AutostartTarget,
  file = autostartFile(),
  platform: NodeJS.Platform = process.platform,
): AutostartStatus => {
  if (platform !== 'win32') throw new Error('Autostart is only set up on Windows');
  if (enabled) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, autostartScript(target));
  } else {
    fs.rmSync(file, { force: true });
  }
  return readAutostart(file, platform);
};
