/**
 * Mod-wide voice localization: synthesize a localized take for every reviewed
 * line the mod has audio for.
 *
 * Resolving the job's settings, checking that TTS is up, and reporting progress
 * are the same for every game; walking the mod's takes and writing the files is
 * the game's voice adapter.
 */
import path from 'node:path';
import { CONFIG } from '../config';
import type { Tx } from '../db';
import { gamePlugin } from '../games/registry';
import type { VoiceJobScope, VoiceLocalizeRequest } from '../games/contract';
import { log } from '../logger';
import { modImportLocalizeDir } from '../modStorage';
import { loadImportedMod } from '../modImport';
import { ensureDir } from '../utils/file';
import { getJobRuntime } from '../pipeline/jobRuntime';
import { ensureDependencyHealthy } from '../pipeline/waitForHealthy';
import { checkTtsHealth } from '../tts/ttsClient';
import { resolveTtsBaseUrl, type TtsReferenceMode } from './voiceToolPaths';
import { loadVoiceProjectSettings } from './voiceProjectSettings';

/**
 * Mod-wide voice job scope:
 * - `missing` — only absent or stale takes (default)
 * - `all` — force-regenerate every synthesizable line
 */
export type ModVoiceGenerateScope = VoiceJobScope;

export type LocalizeModImportVoiceOptions = {
  extractDir: string;
  pluginPath?: string;
  modId: number;
  srcLang?: string;
  tgtLang?: string;
  ttsBaseUrl?: string;
  limit?: number;
  dryRun?: boolean;
  force?: boolean;
  scope?: ModVoiceGenerateScope;
  referenceMode?: TtsReferenceMode;
  /** Restrict synthesis to these `FORMID6:variant` keys. */
  onlyKeys?: ReadonlySet<string>;
  /** Restrict synthesis to one speaker. */
  speakerKey?: string;
  /** When set, skip the pre-pass count (caller already knows `total`). */
  knownTotal?: number;
  onProgress?: (done: number, total: number) => void;
  shouldCancel?: () => boolean;
  signal?: AbortSignal;
};

export type LocalizeModImportVoiceResult = {
  modId: number;
  modName: string;
  localizeDir: string;
  written: string[];
  skipped: string[];
  warnings: string[];
};

/** Count the lines a mod-wide job would synthesize, for the progress total. */
export const countVoiceLocalizeWork = async (
  db: Tx,
  request: VoiceLocalizeRequest,
): Promise<number> => {
  const voice = gamePlugin(request.game).voice;
  if (!voice) return 0;
  return voice.countLocalizeWork(db, request);
};

/** Synthesize localized voice takes into `_localize_{hash}/{lang}/`. */
export const localizeModImportVoice = async (
  db: Tx,
  options: LocalizeModImportVoiceOptions,
): Promise<LocalizeModImportVoiceResult> => {
  const extractDir = path.resolve(options.extractDir);

  if (!options.dryRun) {
    if (getJobRuntime()) await ensureDependencyHealthy('tts');
    else await checkTtsHealth(options.ttsBaseUrl);
  }

  const mod = await loadImportedMod(db, options.modId);
  const plugin = gamePlugin(mod.game);
  const srcLang = options.srcLang?.trim() || mod.srcLang;
  const tgtLang = options.tgtLang?.trim() || CONFIG.defaultTgtLang;
  const ttsBaseUrl = options.ttsBaseUrl ?? resolveTtsBaseUrl();
  const voiceConfig = await loadVoiceProjectSettings(db, mod.game);

  const localizeDir = modImportLocalizeDir(extractDir, tgtLang);
  ensureDir(localizeDir);

  const scope = options.scope ?? 'missing';
  const sink = { written: [] as string[], skipped: [] as string[], warnings: [] as string[] };

  if (!plugin.voice) {
    log.info(`Voice localize skipped: ${plugin.id} has no voice support`);
    return { modId: mod.modId, modName: mod.modName, localizeDir, ...sink };
  }

  let progressDone = 0;
  const request: VoiceLocalizeRequest = {
    modId: mod.modId,
    game: plugin.id,
    extractDir,
    pluginPath: options.pluginPath,
    srcLang,
    tgtLang,
    ttsBaseUrl,
    synthesis: voiceConfig.synthesis,
    referenceMode: options.referenceMode ?? voiceConfig.referenceMode,
    scope,
    // `all` always force-regenerates; an explicit `force` still wins for either scope.
    force: options.force ?? scope === 'all',
    dryRun: options.dryRun ?? false,
    limit: options.limit,
    onlyKeys: options.onlyKeys,
    speakerKey: options.speakerKey?.trim() || undefined,
    shouldCancel: options.shouldCancel,
    signal: options.signal,
  };

  const total =
    options.knownTotal ??
    (options.dryRun || options.onProgress == null
      ? 0
      : await plugin.voice.countLocalizeWork(db, request));

  if (options.onProgress) {
    request.onEligibleStep = () => {
      progressDone += 1;
      options.onProgress?.(progressDone, total);
    };
  }

  log.info(
    `Voice localize "${mod.modName}" → ${localizeDir} (mod id=${mod.modId}, ${srcLang}→${tgtLang}, ` +
      `TTS=${ttsBaseUrl}, refMode=${request.referenceMode}, scope=${scope}, force=${request.force}` +
      `${request.speakerKey ? `, speaker=${request.speakerKey}` : ''})`,
  );

  await plugin.voice.localize(db, request, sink);

  return { modId: mod.modId, modName: mod.modName, localizeDir, ...sink };
};
