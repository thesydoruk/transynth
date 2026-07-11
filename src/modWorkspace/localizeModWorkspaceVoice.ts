import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractXwmFromFuzFile, writeFuz } from '../formats/fuz';
import { log } from '../logger';
import { checkXttsHealth, synthesizeXttsWav } from '../tts/xttsClient';
import type { GameType } from '../types';
import { ensureDir } from '../utils/file';
import { convertToFo4Wav, decodeAudioToReferenceWav, writeTempWav } from '../voice/ffmpegAudio';
import { generateLipFile } from '../voice/faceFxLipGen';
import { ensureVoiceToolsInstalled } from '../tools/installTools';
import {
  resolveXttsUkBaseUrl,
  resolveXttsUkLanguage,
  resolveTtsReferenceMode,
  type TtsReferenceMode,
} from '../voice/voiceToolPaths';
import { encodeWavToXwm } from '../voice/xwmEncode';
import {
  dedupeVoiceFiles,
  discoverVoiceFiles,
  resolveVoiceRootRel,
  type VoiceFileEntry,
} from './discoverVoiceFiles';
import {
  groupVoiceFilesBySpeaker,
  resolveSpeakerReferenceForSpeaker,
  voiceSpeakerKey,
  type ResolvedSpeakerReference,
} from './speakerReferencePool';
import {
  loadVoiceSources,
  loadVoiceTranslations,
  lookupVoiceSource,
  voiceTranslationMapKey,
  type VoiceSourceRow,
} from './loadVoiceTranslations';
import { migrateVoiceSpeakerRefsFromJsonIfNeeded } from './voiceSpeakerRefs';
import {
  pluginRelPath,
  resolveDbModForImport,
  resolveImportPackages,
  writeIfChanged,
  type ImportPackageContext,
} from './localizeModWorkspace';
import { CONFIG } from '../config';
import type { Tx } from '../db';

export type LocalizeModImportVoiceOptions = {
  extractDir: string;
  pluginPath?: string;
  modId?: number;
  srcLang?: string;
  tgtLang?: string;
  game?: GameType;
  xttsBaseUrl?: string;
  limit?: number;
  dryRun?: boolean;
  force?: boolean;
  referenceMode?: TtsReferenceMode;
  /** @deprecated Prefer {@link referenceMode}. */
  speakerReference?: boolean;
};

export type LocalizeModImportVoiceResult = {
  modId: number;
  modName: string;
  localizeDir: string;
  written: string[];
  skipped: string[];
  warnings: string[];
};

const normalizeRelPath = (relPath: string): string => relPath.replace(/\\/g, '/');

const toDiskPath = (rootDir: string, relPath: string): string => {
  const parts = normalizeRelPath(relPath).split('/').filter(Boolean);
  return path.join(rootDir, ...parts);
};

const outputFuzRelPath = (entry: VoiceFileEntry): string => {
  const base = entry.fileName.replace(/\.(fuz|wav|xwm)$/i, '');
  return normalizeRelPath(path.join(path.dirname(entry.relPath), `${base}.fuz`));
};

const outputTtsWavRelPath = (entry: VoiceFileEntry): string => {
  const base = entry.fileName.replace(/\.(fuz|wav|xwm)$/i, '');
  return normalizeRelPath(path.join(path.dirname(entry.relPath), `${base}.tts.wav`));
};

const outputRefWavRelPath = (entry: VoiceFileEntry): string => {
  const base = entry.fileName.replace(/\.(fuz|wav|xwm)$/i, '');
  return normalizeRelPath(path.join(path.dirname(entry.relPath), `${base}.ref.wav`));
};

type SynthesizedVoice = {
  fuz: Buffer;
  ttsWav: Buffer;
};

const prepareReferenceAudio = async (entry: VoiceFileEntry, tempDir: string): Promise<string> => {
  const referencePath = path.join(tempDir, `${entry.formidLower6}_${entry.variant}.ref.wav`);
  if (entry.ext === 'wav') {
    await decodeAudioToReferenceWav(entry.absolutePath, referencePath);
    return referencePath;
  }

  const sourceAudioPath = path.join(tempDir, `${entry.formidLower6}_${entry.variant}.src.audio`);
  if (entry.ext === 'fuz') {
    const xwm = extractXwmFromFuzFile(entry.absolutePath);
    fs.writeFileSync(`${sourceAudioPath}.xwm`, xwm);
    await decodeAudioToReferenceWav(`${sourceAudioPath}.xwm`, referencePath);
    return referencePath;
  }

  await decodeAudioToReferenceWav(entry.absolutePath, referencePath);
  return referencePath;
};

type SpeakerRefCacheEntry = {
  wavPath: string;
  referenceText: string | null;
};

const referenceTextForPick = (
  sources: Map<string, VoiceSourceRow>,
  pick: ResolvedSpeakerReference['pick'],
): string | null => {
  if (pick.formidLower6.toUpperCase() === 'MANUAL') return null;
  return lookupVoiceSource(sources, pick.formidLower6, pick.variant);
};

const synthesizeVoicedFuz = async (
  game: GameType,
  entry: VoiceFileEntry,
  translation: string,
  referenceWavPath: string,
  speakerText: string | null,
  workDir: string,
  xttsBaseUrl: string,
  xttsLanguage: string,
): Promise<SynthesizedVoice> => {
  const stem = `${entry.formidLower6}_${entry.variant}`;
  const rawTtsWav = path.join(workDir, `${stem}.tts.raw.wav`);
  const fo4Wav = path.join(workDir, `${stem}.fo4.wav`);
  const lipPath = path.join(workDir, `${stem}.lip`);
  const xwmPath = path.join(workDir, `${stem}.xwm`);

  const ttsBytes = await synthesizeXttsWav(translation, referenceWavPath, {
    baseUrl: xttsBaseUrl,
    language: xttsLanguage,
    speakerText: speakerText ?? undefined,
  });
  writeTempWav(rawTtsWav, ttsBytes);
  await convertToFo4Wav(rawTtsWav, fo4Wav);
  await generateLipFile(game, fo4Wav, lipPath, translation);
  await encodeWavToXwm(fo4Wav, xwmPath);

  const lip = fs.readFileSync(lipPath);
  const xwm = fs.readFileSync(xwmPath);
  return { fuz: writeFuz(lip, xwm), ttsWav: ttsBytes };
};

const resolveReferenceMode = (
  options: Pick<LocalizeModWorkspaceVoiceOptions, 'referenceMode' | 'speakerReference'>,
): TtsReferenceMode => {
  if (options.referenceMode) return options.referenceMode;
  if (options.speakerReference === false) return 'line';
  if (options.speakerReference === true) return 'speaker';
  return resolveTtsReferenceMode();
};

const localizeVoicePackage = async (
  db: Tx,
  modId: number,
  pkg: ImportPackageContext,
  game: GameType,
  srcLang: string,
  tgtLang: string,
  options: Required<
    Pick<LocalizeModWorkspaceVoiceOptions, 'xttsBaseUrl' | 'dryRun' | 'force' | 'referenceMode'>
  > & {
    limit?: number;
  },
  written: string[],
  skipped: string[],
  warnings: string[],
): Promise<void> => {
  const prefix = pkg.folder ? `${pkg.folder}/` : '';
  const pluginRel = pluginRelPath(pkg.packageDir, pkg.pluginPath);
  const translations = await loadVoiceTranslations(db, modId, srcLang, tgtLang);
  const voiceSources = await loadVoiceSources(db, modId, srcLang);
  const voiceFiles = dedupeVoiceFiles(discoverVoiceFiles(pkg.packageDir, pluginRel));

  if (voiceFiles.length === 0) {
    log.info(`No voice files under ${prefix}${resolveVoiceRootRel(pluginRel)}`);
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-voice-'));
  let processed = 0;

  const voiceRootRel = resolveVoiceRootRel(pluginRel);
  const speakerRefCache = new Map<string, SpeakerRefCacheEntry>();
  let voiceFilesBySpeaker: Map<string, VoiceFileEntry[]> | undefined;

  const getSiblingEntries = (speakerKey: string, current: VoiceFileEntry): VoiceFileEntry[] => {
    if (!voiceFilesBySpeaker) {
      voiceFilesBySpeaker = groupVoiceFilesBySpeaker(voiceFiles, voiceRootRel);
    }
    return (voiceFilesBySpeaker.get(speakerKey) ?? []).filter(
      (candidate) =>
        candidate.formidLower6 !== current.formidLower6 || candidate.variant !== current.variant,
    );
  };

  if (options.referenceMode === 'speaker' && !options.dryRun) {
    await migrateVoiceSpeakerRefsFromJsonIfNeeded(db, modId);
  }

  try {
    for (const entry of voiceFiles) {
      if (options.limit != null && processed >= options.limit) break;

      const row = translations.get(voiceTranslationMapKey(entry.formidLower6, entry.variant));
      if (!row) {
        skipped.push(`${prefix}${entry.relPath} (no translation for variant ${entry.variant})`);
        continue;
      }

      const outRel = outputFuzRelPath(entry);
      const ttsWavRel = outputTtsWavRelPath(entry);
      const refWavRel = outputRefWavRelPath(entry);
      const destPath = toDiskPath(pkg.localizeDir, outRel);
      const ttsWavDest = toDiskPath(pkg.localizeDir, ttsWavRel);
      const refWavDest = toDiskPath(pkg.localizeDir, refWavRel);
      const baselinePath = toDiskPath(pkg.packageDir, outRel);

      if (options.dryRun) {
        log.info(`[dry-run] ${prefix}${outRel} ← "${row.translation.slice(0, 80)}..."`);
        processed += 1;
        continue;
      }

      try {
        const workDir = path.join(tempRoot, `${entry.formidLower6}_${entry.variant}`);
        ensureDir(workDir);

        const speakerKey = voiceSpeakerKey(entry, voiceRootRel);
        let referenceWav: string | undefined;
        let referenceText: string | null =
          options.referenceMode === 'line'
            ? row.source
            : lookupVoiceSource(voiceSources, entry.formidLower6, entry.variant);
        if (options.referenceMode === 'speaker' && speakerKey) {
          const cached = speakerRefCache.get(speakerKey);
          if (cached) {
            referenceWav = cached.wavPath;
            referenceText = cached.referenceText;
          } else {
            const resolved = await resolveSpeakerReferenceForSpeaker(
              db,
              modId,
              speakerKey,
              entry,
              () => getSiblingEntries(speakerKey, entry),
              pkg.packageDir,
              pluginRel,
            );
            if (resolved) {
              referenceWav = resolved.wavPath;
              referenceText = referenceTextForPick(voiceSources, resolved.pick);
              speakerRefCache.set(speakerKey, {
                wavPath: resolved.wavPath,
                referenceText,
              });
            }
          }
        }

        const finalReferenceWav =
          options.referenceMode === 'line'
            ? await prepareReferenceAudio(entry, workDir)
            : (referenceWav ?? (await prepareReferenceAudio(entry, workDir)));
        if (!referenceText) {
          referenceText = lookupVoiceSource(voiceSources, entry.formidLower6, entry.variant);
        }
        const { fuz: fuzData, ttsWav } = await synthesizeVoicedFuz(
          game,
          entry,
          row.translation,
          finalReferenceWav,
          referenceText,
          workDir,
          options.xttsBaseUrl,
          resolveXttsUkLanguage(),
        );

        // TODO: remove — keep TTS + reference WAV next to .fuz for A/B listening.
        ensureDir(path.dirname(ttsWavDest));
        fs.writeFileSync(ttsWavDest, ttsWav);
        fs.copyFileSync(finalReferenceWav, refWavDest);
        written.push(prefix + ttsWavRel);
        written.push(prefix + refWavRel);

        if (
          !options.force &&
          writeIfChanged(destPath, fuzData, fs.existsSync(baselinePath) ? baselinePath : null)
        ) {
          written.push(prefix + outRel);
        } else if (options.force) {
          ensureDir(path.dirname(destPath));
          fs.writeFileSync(destPath, fuzData);
          written.push(prefix + outRel);
        } else {
          skipped.push(prefix + outRel);
        }
        processed += 1;
        log.info(`Voice ${prefix}${outRel}`);
      } catch (err) {
        warnings.push(
          `${prefix}${entry.relPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};

export const localizeModImportVoice = async (
  db: Tx,
  options: LocalizeModImportVoiceOptions,
): Promise<LocalizeModImportVoiceResult> => {
  const extractDir = path.resolve(options.extractDir);

  if (!options.dryRun) {
    await ensureVoiceToolsInstalled();
    await checkXttsHealth(options.xttsBaseUrl);
  }

  const mod = await resolveDbModForImport(db, path.basename(extractDir), options.modId);
  const srcLang = options.srcLang?.trim() || mod.srcLang;
  const tgtLang = options.tgtLang?.trim() || CONFIG.defaultTgtLang;
  const game = options.game ?? mod.game;
  const xttsBaseUrl = options.xttsBaseUrl ?? resolveXttsUkBaseUrl();
  const referenceMode = resolveReferenceMode(options);

  const packages = resolveImportPackages(extractDir, options.pluginPath);
  const localizeDir = path.join(extractDir, 'localize');
  ensureDir(localizeDir);

  const written: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];

  log.info(
    `Voice localize "${mod.modName}" → ${localizeDir} (mod id=${mod.modId}, ${srcLang}→${tgtLang}, XTTS=${xttsBaseUrl}, refMode=${referenceMode})`,
  );

  for (const pkg of packages) {
    await localizeVoicePackage(
      db,
      mod.modId,
      pkg,
      game,
      srcLang,
      tgtLang,
      {
        xttsBaseUrl,
        dryRun: options.dryRun ?? false,
        force: options.force ?? false,
        referenceMode,
        limit: options.limit,
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
