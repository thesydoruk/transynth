/**
 * The resident agent's configuration: one JSON file on the Vortex machine.
 *
 * Defaults follow Vortex's own layout (`%APPDATA%\Vortex\downloads\<game>`), the
 * agent's own files go to `%LOCALAPPDATA%\Transynth\vortex-agent`, and the CLI
 * token from the environment wins over the one in the file.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allGamePlugins } from '../../games/registry';
import type { GameId } from '../../types';
import { vortexGameId } from '../gameProfiles';
import type { VortexChannel } from '../stages';

export type AgentAutoStage = 'import' | 'carry' | 'tm';

export type AgentConfig = {
  api: string;
  token: string;
  game: GameId;
  stagingPath: string;
  gameDir: string;
  /** Vortex's downloads folder for the game; the langpack is dropped here. */
  downloadsDir: string;
  pluginsTxt?: string;
  vortexProfile?: string;
  srcLang: string;
  tgtLang: string;
  channel: VortexChannel;
  pollSec: number;
  settleSec: number;
  fullScanEveryMin: number;
  /** The last stage the agent runs on its own; never beyond TM. */
  autoStages: AgentAutoStage;
  deliverLangpack: boolean;
  /** Register the game's cutscene videos and upload their narration track. Off by default. */
  videos: boolean;
  /** ffmpeg / ffprobe for the video audio; bare names resolve through PATH. */
  ffmpegPath: string;
  ffprobePath: string;
  /** Bink track id to upload when the video has it (the English one); else the lowest id. */
  videoSourceTrack?: number;
  /** RAD Video Tools folder (`radvideo64.exe`), for writing the dub back into the video. */
  radVideoToolsPath?: string;
};

const AUTO_STAGES: readonly AgentAutoStage[] = ['import', 'carry', 'tm'];

const roaming = (): string => process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const local = (): string => process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

export const defaultConfigPath = (): string =>
  path.join(roaming(), 'Transynth', 'vortex-agent.json');

/** State, hash cache and journal: local, not roaming. */
export const agentDataDir = (): string => path.join(local(), 'Transynth', 'vortex-agent');

export const defaultDownloadsDir = (game: GameId): string =>
  path.join(roaming(), 'Vortex', 'downloads', vortexGameId(game) ?? game);

export const defaultStagingPath = (game: GameId): string =>
  path.join(roaming(), 'Vortex', vortexGameId(game) ?? game, 'mods');

/** What `--init` writes: every key present, the machine-specific ones empty. */
export const configTemplate = (game: GameId = 'fo4'): AgentConfig => ({
  api: 'http://127.0.0.1:3200',
  token: '',
  game,
  stagingPath: defaultStagingPath(game),
  gameDir: '',
  downloadsDir: defaultDownloadsDir(game),
  srcLang: 'en',
  tgtLang: 'uk',
  channel: 'all',
  pollSec: 30,
  settleSec: 90,
  fullScanEveryMin: 360,
  autoStages: 'tm',
  deliverLangpack: true,
  videos: false,
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
});

const isDeployableGame = (value: unknown): value is GameId =>
  typeof value === 'string' && allGamePlugins().some((p) => p.id === value && p.deployment);

const num = (value: unknown, fallback: number, min: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min ? value : fallback;

/** Parse and validate a config object; throws with every problem listed. */
export const parseAgentConfig = (
  raw: unknown,
  env: NodeJS.ProcessEnv = process.env,
): AgentConfig => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const problems: string[] = [];
  if (!isDeployableGame(r.game)) problems.push('game must be a game Vortex deploys (e.g. fo4)');
  const game = (isDeployableGame(r.game) ? r.game : 'fo4') as GameId;
  const template = configTemplate(game);
  const str = (key: keyof AgentConfig): string =>
    typeof r[key] === 'string' ? (r[key] as string).trim() : '';
  const config: AgentConfig = {
    api: (str('api') || template.api).replace(/\/+$/, ''),
    token: env.TRANSYNTH_CLI_TOKEN?.trim() || str('token'),
    game,
    stagingPath: str('stagingPath') || template.stagingPath,
    gameDir: str('gameDir'),
    downloadsDir: str('downloadsDir') || template.downloadsDir,
    ...(str('pluginsTxt') ? { pluginsTxt: str('pluginsTxt') } : {}),
    ...(str('vortexProfile') ? { vortexProfile: str('vortexProfile') } : {}),
    srcLang: str('srcLang') || template.srcLang,
    tgtLang: str('tgtLang') || template.tgtLang,
    channel: (['all', 'mods', 'game'] as const).includes(r.channel as VortexChannel)
      ? (r.channel as VortexChannel)
      : 'all',
    pollSec: num(r.pollSec, template.pollSec, 5),
    settleSec: num(r.settleSec, template.settleSec, 0),
    fullScanEveryMin: num(r.fullScanEveryMin, template.fullScanEveryMin, 1),
    autoStages: AUTO_STAGES.includes(r.autoStages as AgentAutoStage)
      ? (r.autoStages as AgentAutoStage)
      : 'tm',
    deliverLangpack: r.deliverLangpack !== false,
    videos: r.videos === true,
    ffmpegPath: str('ffmpegPath') || template.ffmpegPath,
    ffprobePath: str('ffprobePath') || template.ffprobePath,
    ...(Number.isInteger(r.videoSourceTrack) && (r.videoSourceTrack as number) >= 0
      ? { videoSourceTrack: r.videoSourceTrack as number }
      : {}),
    ...(str('radVideoToolsPath') ? { radVideoToolsPath: str('radVideoToolsPath') } : {}),
  };
  if (!config.gameDir) problems.push('gameDir is required (the game install folder)');
  if (r.autoStages !== undefined && !AUTO_STAGES.includes(r.autoStages as AgentAutoStage)) {
    problems.push(
      `autoStages must be one of ${AUTO_STAGES.join(', ')} — the agent never runs more`,
    );
  }
  if (problems.length > 0) throw new Error(`vortex-agent config: ${problems.join('; ')}`);
  return config;
};

export const loadAgentConfig = (file = defaultConfigPath()): AgentConfig => {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Error(`No agent config at ${file} — run with --init to write a template`);
  }
  const config = parseAgentConfig(JSON.parse(text));
  for (const [key, dir] of [
    ['stagingPath', config.stagingPath],
    ['gameDir', config.gameDir],
  ] as const) {
    if (!fs.existsSync(dir)) throw new Error(`vortex-agent config: ${key} does not exist: ${dir}`);
  }
  return config;
};

/** Write the template unless a config already exists; returns the path. */
export const writeConfigTemplate = (file = defaultConfigPath(), game: GameId = 'fo4'): string => {
  if (fs.existsSync(file)) throw new Error(`Config already exists: ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(configTemplate(game), null, 2)}\n`);
  return file;
};
