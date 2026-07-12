import path from 'node:path';
import { CONFIG } from '../config';
import type { Tx } from '../db';
import { log } from '../logger';
import { modImportLocalizeDir } from '../modStorage';
import {
  loadImportedMod,
  pluginRelPath,
  resolveImportPackages,
  type ImportPackageContext,
} from '../modImport';
import { ensureDir } from '../utils/file';
import { checkXttsHealth } from '../tts/xttsClient';
import { resolveTtsBaseUrl, type TtsReferenceMode } from './voiceToolPaths';
import { loadVoiceProjectSettings } from './voiceProjectSettings';
import { dedupeVoiceFiles, discoverVoiceFiles } from './discoverVoiceFiles';
import { loadVoiceTranslations, lookupVoiceTranslation } from './loadVoiceTranslations';
import { localizeVoicePackage } from './localizeVoicePackage';

export type LocalizeModImportVoiceOptions = {
  extractDir: string;
  pluginPath?: string;
  modId: number;
  srcLang?: string;
  tgtLang?: string;
  xttsBaseUrl?: string;
  limit?: number;
  dryRun?: boolean;
  force?: boolean;
  referenceMode?: TtsReferenceMode;
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

/** Count voice files that have a target translation and can be synthesized. */
export const countVoiceLocalizeWork = async (
  db: Tx,
  modId: number,
  packages: ImportPackageContext[],
  srcLang: string,
  tgtLang: string,
): Promise<number> => {
  let total = 0;
  for (const pkg of packages) {
    const pluginRel = pluginRelPath(pkg.packageDir, pkg.pluginPath);
    const translations = await loadVoiceTranslations(db, modId, srcLang, tgtLang);
    const voiceFiles = dedupeVoiceFiles(discoverVoiceFiles(pkg.packageDir, pluginRel));
    for (const entry of voiceFiles) {
      if (lookupVoiceTranslation(translations, entry.formidLower6, entry.variant)) {
        total += 1;
      }
    }
  }
  return total;
};

/** Synthesize TTS WAV files into `localize/` under a mod import extract tree. */
export const localizeModImportVoice = async (
  db: Tx,
  options: LocalizeModImportVoiceOptions,
): Promise<LocalizeModImportVoiceResult> => {
  const extractDir = path.resolve(options.extractDir);

  if (!options.dryRun) {
    await checkXttsHealth(options.xttsBaseUrl);
  }

  const mod = await loadImportedMod(db, options.modId);
  const srcLang = options.srcLang?.trim() || mod.srcLang;
  const tgtLang = options.tgtLang?.trim() || CONFIG.defaultTgtLang;
  const xttsBaseUrl = options.xttsBaseUrl ?? resolveTtsBaseUrl();
  const voiceConfig = await loadVoiceProjectSettings(db);
  const referenceMode = resolveReferenceMode(options, voiceConfig.referenceMode);

  const packages = resolveImportPackages(extractDir, options.pluginPath);
  const localizeDir = modImportLocalizeDir(extractDir);
  ensureDir(localizeDir);

  const written: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];

  const total =
    options.dryRun || options.onProgress == null
      ? 0
      : await countVoiceLocalizeWork(db, mod.modId, packages, srcLang, tgtLang);
  let progressDone = 0;
  const bumpProgress = () => {
    progressDone += 1;
    options.onProgress?.(progressDone, total);
  };

  log.info(
    `Voice localize "${mod.modName}" → ${localizeDir} (mod id=${mod.modId}, ${srcLang}→${tgtLang}, XTTS=${xttsBaseUrl}, refMode=${referenceMode})`,
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
        xttsBaseUrl,
        dryRun: options.dryRun ?? false,
        force: options.force ?? false,
        referenceMode,
        synthesis: voiceConfig.synthesis,
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
