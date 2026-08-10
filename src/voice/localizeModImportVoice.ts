import path from 'node:path';
import fs from 'node:fs';
import { CONFIG } from '../config';
import type { Tx } from '../db';
import { log } from '../logger';
import { modImportLocalizeDir } from '../modStorage';
import {
  loadImportedMod,
  pluginRelPath,
  resolveImportPackages,
  toDiskPath,
  type ImportPackageContext,
} from '../modImport';
import { ensureDir } from '../utils/file';
import { checkTtsHealth } from '../tts/ttsClient';
import { resolveTtsBaseUrl, type TtsReferenceMode } from './voiceToolPaths';
import { loadVoiceProjectSettings } from './voiceProjectSettings';
import { dedupeVoiceFiles, discoverVoiceFiles } from './discoverVoiceFiles';
import {
  loadVoiceTranslations,
  lookupVoiceTranslation,
  voiceTranslationMapKey,
} from './loadVoiceTranslations';
import { canSynthesizeVoiceLine, prepareVoiceTtsText } from './prepareVoiceTtsText';
import { localizeVoicePackage } from './localizeVoicePackage';
import { outputLocalizedFuzRelPath } from './voiceFilePaths';
import { loadVoiceSynthesisVersionMap } from './voiceSynthesisState';
import {
  isVoiceSynthesisCurrent,
  voiceTtsPayloadVersionFromPrepared,
} from './voiceTtsPayloadVersion';

/**
 * Mod-wide voice job scope:
 * - `missing` — only absent or stale `.fuz` (default)
 * - `all` — force-regenerate every synthesizable line
 */
export type ModVoiceGenerateScope = 'all' | 'missing';

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
  onProgress?: (done: number, total: number) => void;
  shouldCancel?: () => boolean;
};

export type LocalizeModImportVoiceResult = {
  modId: number;
  modName: string;
  localizeDir: string;
  written: string[];
  skipped: string[];
  warnings: string[];
};

const resolveReferenceMode = (
  options: Pick<LocalizeModImportVoiceOptions, 'referenceMode'>,
  projectReferenceMode: TtsReferenceMode,
): TtsReferenceMode => options.referenceMode ?? projectReferenceMode;

/** Count voice files that have a target translation and need synthesis. */
export const countVoiceLocalizeWork = async (
  db: Tx,
  modId: number,
  packages: ImportPackageContext[],
  srcLang: string,
  tgtLang: string,
  scope: ModVoiceGenerateScope = 'missing',
  onlyKeys?: ReadonlySet<string>,
): Promise<number> => {
  const storedVersions = await loadVoiceSynthesisVersionMap(db, modId, tgtLang);
  const forceAll = scope === 'all';
  let total = 0;
  for (const pkg of packages) {
    const pluginRel = pluginRelPath(pkg.packageDir, pkg.pluginPath);
    const translations = await loadVoiceTranslations(db, modId, srcLang, tgtLang);
    const voiceFiles = dedupeVoiceFiles(discoverVoiceFiles(pkg.packageDir, pluginRel));
    for (const entry of voiceFiles) {
      if (onlyKeys && !onlyKeys.has(voiceTranslationMapKey(entry.formidLower6, entry.variant))) {
        continue;
      }
      const row = lookupVoiceTranslation(translations, entry.formidLower6, entry.variant);
      if (!row || !canSynthesizeVoiceLine(row.source, row.translation, row.edid)) {
        continue;
      }
      const prepared = prepareVoiceTtsText({
        lineSource: row.source,
        translation: row.translation,
        speakerSource: row.source,
        edid: row.edid,
      });
      if (prepared.action !== 'synthesize') continue;
      if (!forceAll) {
        const payloadVersion = voiceTtsPayloadVersionFromPrepared(prepared, tgtLang);
        const fuzDest = toDiskPath(pkg.localizeDir, outputLocalizedFuzRelPath(entry));
        const storedVersion = storedVersions.get(
          voiceTranslationMapKey(entry.formidLower6, entry.variant),
        );
        if (isVoiceSynthesisCurrent(storedVersion, payloadVersion, fs.existsSync(fuzDest))) {
          continue;
        }
      }
      total += 1;
    }
  }
  return total;
};

/** Synthesize localized `.fuz` voice files into `_localize_{hash}/{lang}/`. */
export const localizeModImportVoice = async (
  db: Tx,
  options: LocalizeModImportVoiceOptions,
): Promise<LocalizeModImportVoiceResult> => {
  const extractDir = path.resolve(options.extractDir);

  if (!options.dryRun) {
    await checkTtsHealth(options.ttsBaseUrl);
  }

  const mod = await loadImportedMod(db, options.modId);
  const srcLang = options.srcLang?.trim() || mod.srcLang;
  const tgtLang = options.tgtLang?.trim() || CONFIG.defaultTgtLang;
  const ttsBaseUrl = options.ttsBaseUrl ?? resolveTtsBaseUrl();
  const voiceConfig = await loadVoiceProjectSettings(db);
  const referenceMode = resolveReferenceMode(options, voiceConfig.referenceMode);

  const packages = resolveImportPackages(extractDir, tgtLang, options.pluginPath);
  const localizeDir = modImportLocalizeDir(extractDir, tgtLang);
  ensureDir(localizeDir);
  const scope = options.scope ?? 'missing';
  // `all` always force-regenerates; explicit `force` still wins for either scope.
  const force = options.force ?? scope === 'all';

  const written: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];

  const total =
    options.dryRun || options.onProgress == null
      ? 0
      : await countVoiceLocalizeWork(
          db,
          mod.modId,
          packages,
          srcLang,
          tgtLang,
          scope,
          options.onlyKeys,
        );
  let progressDone = 0;
  const bumpProgress = () => {
    progressDone += 1;
    options.onProgress?.(progressDone, total);
  };

  log.info(
    `Voice localize "${mod.modName}" → ${localizeDir} (mod id=${mod.modId}, ${srcLang}→${tgtLang}, TTS=${ttsBaseUrl}, refMode=${referenceMode}, scope=${scope}, force=${force})`,
  );

  for (const pkg of packages) {
    if (options.shouldCancel?.()) break;
    await localizeVoicePackage(
      db,
      mod.modId,
      pkg,
      srcLang,
      tgtLang,
      {
        game: mod.game,
        ttsBaseUrl,
        dryRun: options.dryRun ?? false,
        force,
        scope,
        referenceMode,
        useUkLibrary: voiceConfig.useUkLibrary,
        onlyKeys: options.onlyKeys,
        limit: options.limit,
        shouldCancel: options.shouldCancel,
        onEligibleStep: options.onProgress ? bumpProgress : undefined,
      },
      written,
      skipped,
      warnings,
    );
  }

  return {
    modId: mod.modId,
    modName: mod.modName,
    localizeDir,
    written,
    skipped,
    warnings,
  };
};
