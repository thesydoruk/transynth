/**
 * The settings form of the agent's page: what it shows of the config file and
 * how a submitted form becomes the file. The token goes one way only — the
 * form can set or clear it, never read it. Keys the form does not know stay in
 * the file as they were.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  assertConfigDirs,
  configTemplate,
  deployableGames,
  isDeployableGame,
  parseAgentConfig,
  type AgentConfig,
} from './config';

const FORM_KEYS = [
  'api',
  'game',
  'stagingPath',
  'gameDir',
  'downloadsDir',
  'pluginsTxt',
  'vortexProfile',
  'srcLang',
  'tgtLang',
  'channel',
  'pollSec',
  'settleSec',
  'fullScanEveryMin',
  'autoStages',
  'deliverLangpack',
  'videos',
  'uiPort',
] as const satisfies ReadonlyArray<keyof AgentConfig>;

type FormKey = (typeof FORM_KEYS)[number];

export type ConfigForm = {
  /** False until the file exists: the values are then the template's. */
  exists: boolean;
  values: Record<FormKey, string | number | boolean>;
  games: string[];
  tokenSet: boolean;
  /** `TRANSYNTH_CLI_TOKEN` is set: it wins over whatever the file holds. */
  tokenFromEnv: boolean;
};

const readRaw = (file: string): Record<string, unknown> | null => {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

export const readConfigForm = (file: string, env: NodeJS.ProcessEnv = process.env): ConfigForm => {
  const raw = readRaw(file);
  const merged: Record<string, unknown> = {
    ...configTemplate(isDeployableGame(raw?.game) ? raw.game : 'fo4'),
    ...raw,
  };
  const values = {} as ConfigForm['values'];
  for (const key of FORM_KEYS) {
    const value = merged[key];
    values[key] =
      typeof value === 'number' || typeof value === 'boolean' ? value : String(value ?? '');
  }
  return {
    exists: raw != null,
    values,
    games: deployableGames(),
    tokenSet: typeof raw?.token === 'string' && raw.token.trim() !== '',
    tokenFromEnv: Boolean(env.TRANSYNTH_CLI_TOKEN?.trim()),
  };
};

const NUMBERS: readonly FormKey[] = ['pollSec', 'settleSec', 'fullScanEveryMin', 'uiPort'];

/**
 * Validate a submitted form the way the agent validates its file at start, and
 * write the file only when it would start with it. Throws with every problem.
 */
export const saveConfigForm = (
  file: string,
  body: unknown,
  env: NodeJS.ProcessEnv = process.env,
): AgentConfig => {
  const form = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const raw = readRaw(file) ?? {};
  const next: Record<string, unknown> = { ...raw };
  const problems: string[] = [];
  for (const key of FORM_KEYS) {
    if (!(key in form)) continue;
    next[key] = form[key];
    // The file parser falls back to a default for a bad number; a form must say so.
    if (NUMBERS.includes(key) && !(typeof form[key] === 'number' && Number.isFinite(form[key]))) {
      problems.push(`${key} must be a number`);
    }
  }
  if (typeof form.token === 'string' && form.token.trim()) next.token = form.token.trim();
  else if (form.clearToken === true) next.token = '';
  if (typeof next.pollSec === 'number' && next.pollSec < 5)
    problems.push('pollSec must be 5 or more');
  if (problems.length > 0) throw new Error(`vortex-agent config: ${problems.join('; ')}`);

  const config = parseAgentConfig(next, env);
  assertConfigDirs(config);
  const { token: _envOrFileToken, ...checked } = config;
  const out: Record<string, unknown> = {
    ...next,
    ...checked,
    token: typeof next.token === 'string' ? next.token : '',
  };
  for (const key of ['pluginsTxt', 'vortexProfile'] as const) {
    if (!config[key]) delete out[key];
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(out, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return config;
};
