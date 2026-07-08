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
import { resolveXttsUkBaseUrl, resolveXttsUkLanguage } from '../voice/voiceToolPaths';
import { encodeWavToXwm } from '../voice/xwmEncode';
import {
  dedupeVoiceFiles,
  discoverVoiceFiles,
  resolveVoiceRootRel,
  type VoiceFileEntry,
} from './discoverVoiceFiles';
import { loadVoiceTranslations } from './loadVoiceTranslations';
import {
  pluginRelPath,
  resolveDbModForWorkspace,
  resolveWorkspacePackages,
  writeIfChanged,
  type WorkspacePackageContext,
} from './localizeModWorkspace';
import { readModWorkspaceManifest } from './archiveManifest';
import { CONFIG } from '../config';
import type { Tx } from '../db';

export type LocalizeModWorkspaceVoiceOptions = {
  workspaceDir: string;
  modId?: number;
  srcLang?: string;
  tgtLang?: string;
  game?: GameType;
  xttsBaseUrl?: string;
  limit?: number;
  dryRun?: boolean;
  force?: boolean;
};

export type LocalizeModWorkspaceVoiceResult = {
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

const synthesizeVoicedFuz = async (
  game: GameType,
  entry: VoiceFileEntry,
  translation: string,
  referenceWavPath: string,
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
  });
  writeTempWav(rawTtsWav, ttsBytes);
  await convertToFo4Wav(rawTtsWav, fo4Wav);
  await generateLipFile(game, fo4Wav, lipPath, translation);
  await encodeWavToXwm(fo4Wav, xwmPath);

  const lip = fs.readFileSync(lipPath);
  const xwm = fs.readFileSync(xwmPath);
  return { fuz: writeFuz(lip, xwm), ttsWav: ttsBytes };
};

const localizeVoicePackage = async (
  db: Tx,
  modId: number,
  pkg: WorkspacePackageContext,
  game: GameType,
  srcLang: string,
  tgtLang: string,
  options: Required<Pick<LocalizeModWorkspaceVoiceOptions, 'xttsBaseUrl' | 'dryRun' | 'force'>> & {
    limit?: number;
  },
  written: string[],
  skipped: string[],
  warnings: string[],
): Promise<void> => {
  const prefix = pkg.folder ? `${pkg.folder}/` : '';
  const pluginRel = pluginRelPath(pkg.packageDir, pkg.pluginPath);
  const translations = await loadVoiceTranslations(db, modId, srcLang, tgtLang);
  const voiceFiles = dedupeVoiceFiles(discoverVoiceFiles(pkg.packageDir, pluginRel));

  if (voiceFiles.length === 0) {
    log.info(`No voice files under ${prefix}${resolveVoiceRootRel(pluginRel)}`);
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-voice-'));
  let processed = 0;

  try {
    for (const entry of voiceFiles) {
      if (options.limit != null && processed >= options.limit) break;

      const row = translations.get(entry.formidLower6);
      if (!row) {
        skipped.push(`${prefix}${entry.relPath} (no translation)`);
        continue;
      }

      const outRel = outputFuzRelPath(entry);
      const ttsWavRel = outputTtsWavRelPath(entry);
      const destPath = toDiskPath(pkg.localizeDir, outRel);
      const ttsWavDest = toDiskPath(pkg.localizeDir, ttsWavRel);
      const baselinePath = toDiskPath(pkg.packageDir, outRel);

      if (options.dryRun) {
        log.info(`[dry-run] ${prefix}${outRel} ← "${row.translation.slice(0, 80)}..."`);
        processed += 1;
        continue;
      }

      try {
        const workDir = path.join(tempRoot, `${entry.formidLower6}_${entry.variant}`);
        ensureDir(workDir);
        const referenceWav = await prepareReferenceAudio(entry, workDir);
        const { fuz: fuzData, ttsWav } = await synthesizeVoicedFuz(
          game,
          entry,
          row.translation,
          referenceWav,
          workDir,
          options.xttsBaseUrl,
          resolveXttsUkLanguage(),
        );

        // TODO: remove — keep raw TTS WAV next to .fuz for listening/debug.
        ensureDir(path.dirname(ttsWavDest));
        fs.writeFileSync(ttsWavDest, ttsWav);
        written.push(prefix + ttsWavRel);

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

export const localizeModWorkspaceVoice = async (
  db: Tx,
  options: LocalizeModWorkspaceVoiceOptions,
): Promise<LocalizeModWorkspaceVoiceResult> => {
  const workspaceDir = path.resolve(options.workspaceDir);
  const manifest = readModWorkspaceManifest(workspaceDir);
  const lookupName = manifest?.modName?.trim() || path.basename(workspaceDir);

  if (!options.dryRun) {
    await ensureVoiceToolsInstalled();
    await checkXttsHealth(options.xttsBaseUrl);
  }

  const mod = await resolveDbModForWorkspace(db, lookupName, options.modId);
  const srcLang = options.srcLang?.trim() || mod.srcLang;
  const tgtLang = options.tgtLang?.trim() || CONFIG.defaultTgtLang;
  const game = options.game ?? manifest?.game ?? mod.game;
  const xttsBaseUrl = options.xttsBaseUrl ?? resolveXttsUkBaseUrl();

  const packages = resolveWorkspacePackages(workspaceDir, manifest?.packages);
  const localizeDir = path.join(workspaceDir, 'localize');
  ensureDir(localizeDir);

  const written: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];

  log.info(
    `Voice localize "${lookupName}" → localize/ (mod id=${mod.modId}, ${srcLang}→${tgtLang}, XTTS=${xttsBaseUrl})`,
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
