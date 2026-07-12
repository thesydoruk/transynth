import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../db';
import type { GameType } from '../types';
import { pluginRelPath, toDiskPath, writeIfChanged } from '../modImport';
import { loadImportedMod } from '../modImport/importedMod';
import { ensureDir } from '../utils/file';
import { checkXttsHealth, synthesizeXttsWav } from '../tts/xttsClient';
import {
  dedupeVoiceFiles,
  discoverVoiceFiles,
  resolveVoiceRootRel,
  type VoiceFileEntry,
} from './discoverVoiceFiles';
import {
  loadVoiceSources,
  loadVoiceTranslations,
  lookupVoiceSource,
  lookupVoiceTranslation,
} from './loadVoiceTranslations';
import { migrateVoiceSpeakerRefsFromJsonIfNeeded } from './voiceSpeakerRefs';
import {
  groupVoiceFilesBySpeaker,
  resolveSpeakerReferenceForSpeaker,
  voiceSpeakerKey,
} from './speakerReferencePool';
import { prepareReferenceAudio } from './prepareReferenceAudio';
import { buildVoicedFuzFromTtsWav } from './synthesizeVoicedFuz';
import { outputLocalizedFuzRelPath, outputTtsWavRelPath } from './voiceFilePaths';
import { resolveTtsBaseUrl, resolveTtsLanguage, type TtsReferenceMode } from './voiceToolPaths';
import { loadVoiceProjectSettings } from './voiceProjectSettings';

export type SynthesizeModVoiceLineResult =
  | { ok: true; relPath: string; skipped: boolean }
  | {
      ok: false;
      reason: 'line_not_found' | 'no_translation' | 'no_localize_dir' | 'tts_failed';
      message: string;
    };

export const resolveLocalizedFuzAbsPath = (
  localizeDir: string | null,
  entry: VoiceFileEntry,
): string | null => {
  if (!localizeDir) return null;
  return toDiskPath(localizeDir, outputLocalizedFuzRelPath(entry));
};

/** @deprecated Use {@link resolveLocalizedFuzAbsPath}. */
export const resolveTtsWavAbsPath = (
  localizeDir: string | null,
  entry: VoiceFileEntry,
): string | null => {
  if (!localizeDir) return null;
  return toDiskPath(localizeDir, outputTtsWavRelPath(entry));
};

export const resolveLocalizedVoiceAbsPath = (
  localizeDir: string | null,
  entry: VoiceFileEntry,
): string | null => {
  const fuzPath = resolveLocalizedFuzAbsPath(localizeDir, entry);
  if (fuzPath && fs.existsSync(fuzPath)) return fuzPath;
  const legacyWavPath = resolveTtsWavAbsPath(localizeDir, entry);
  if (legacyWavPath && fs.existsSync(legacyWavPath)) return legacyWavPath;
  return fuzPath;
};

const findVoiceEntry = (
  entries: VoiceFileEntry[],
  formidLower6: string,
  variant: number,
): VoiceFileEntry | undefined =>
  entries.find(
    (entry) =>
      entry.formidLower6.toUpperCase() === formidLower6.toUpperCase() && entry.variant === variant,
  );

/** Synthesize one voiced line into `localize/` as a localized `.fuz` file. */
export const synthesizeModVoiceLine = async (
  db: Tx,
  opts: {
    modId: number;
    packageDir: string;
    pluginPath: string;
    localizeDir: string;
    formidLower6: string;
    variant: number;
    srcLang: string;
    tgtLang: string;
    game?: GameType;
    referenceMode?: TtsReferenceMode;
    xttsBaseUrl?: string;
    force?: boolean;
  },
): Promise<SynthesizeModVoiceLineResult> => {
  const pluginRel = pluginRelPath(opts.packageDir, opts.pluginPath);
  const voiceFiles = dedupeVoiceFiles(discoverVoiceFiles(opts.packageDir, pluginRel));
  const entry = findVoiceEntry(voiceFiles, opts.formidLower6, opts.variant);
  if (!entry) {
    return { ok: false, reason: 'line_not_found', message: 'Voice line not found' };
  }

  const translations = await loadVoiceTranslations(db, opts.modId, opts.srcLang, opts.tgtLang);
  const row = lookupVoiceTranslation(translations, entry.formidLower6, entry.variant);
  if (!row?.translation?.trim()) {
    return { ok: false, reason: 'no_translation', message: 'No translation for this voice line' };
  }

  if (!opts.localizeDir) {
    return {
      ok: false,
      reason: 'no_localize_dir',
      message: 'Mod import localize directory not found',
    };
  }

  const voiceConfig = await loadVoiceProjectSettings(db);
  const referenceMode = opts.referenceMode ?? voiceConfig.referenceMode;
  const xttsBaseUrl = opts.xttsBaseUrl ?? resolveTtsBaseUrl();
  const mod = await loadImportedMod(db, opts.modId);
  const game = opts.game ?? mod.game;
  await checkXttsHealth(xttsBaseUrl);

  if (referenceMode === 'speaker') {
    await migrateVoiceSpeakerRefsFromJsonIfNeeded(db, opts.modId);
  }

  const fuzRel = outputLocalizedFuzRelPath(entry);
  const fuzDest = toDiskPath(opts.localizeDir, fuzRel);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-voice-line-'));

  try {
    const workDir = path.join(tempRoot, `${entry.formidLower6}_${entry.variant}`);
    ensureDir(workDir);

    const voiceRootRel = resolveVoiceRootRel(pluginRel);
    const voiceSources = await loadVoiceSources(db, opts.modId, opts.srcLang);
    const speakerKey = voiceSpeakerKey(entry, voiceRootRel);

    let referenceWav: string | undefined;
    let referenceText: string | null =
      referenceMode === 'line'
        ? row.source
        : lookupVoiceSource(voiceSources, entry.formidLower6, entry.variant);

    if (referenceMode === 'speaker' && speakerKey) {
      const siblings = groupVoiceFilesBySpeaker(voiceFiles, voiceRootRel)
        .get(speakerKey)
        ?.filter(
          (candidate) =>
            candidate.formidLower6 !== entry.formidLower6 || candidate.variant !== entry.variant,
        );
      const resolved = await resolveSpeakerReferenceForSpeaker(
        db,
        opts.modId,
        speakerKey,
        entry,
        () => siblings ?? [],
        opts.packageDir,
        pluginRel,
      );
      if (resolved) {
        referenceWav = resolved.wavPath;
        if (resolved.pick.formidLower6.toUpperCase() !== 'MANUAL') {
          referenceText = lookupVoiceSource(
            voiceSources,
            resolved.pick.formidLower6,
            resolved.pick.variant,
          );
        }
      }
    }

    const finalReferenceWav =
      referenceMode === 'line'
        ? await prepareReferenceAudio(entry, workDir)
        : (referenceWav ?? (await prepareReferenceAudio(entry, workDir)));
    if (!referenceText) {
      referenceText = lookupVoiceSource(voiceSources, entry.formidLower6, entry.variant);
    }

    const ttsWav = await synthesizeXttsWav(row.translation, finalReferenceWav, {
      baseUrl: xttsBaseUrl,
      language: resolveTtsLanguage(opts.tgtLang),
      speakerText: referenceText ?? undefined,
      synthesis: voiceConfig.synthesis,
    });

    const fuzData = await buildVoicedFuzFromTtsWav(
      game,
      ttsWav,
      workDir,
      entry.fileName,
      row.translation,
    );

    const baselinePath = fs.existsSync(fuzDest) ? fuzDest : null;
    if (!opts.force && writeIfChanged(fuzDest, fuzData, baselinePath)) {
      return { ok: true, relPath: fuzRel, skipped: false };
    }
    if (opts.force) {
      ensureDir(path.dirname(fuzDest));
      fs.writeFileSync(fuzDest, fuzData);
      return { ok: true, relPath: fuzRel, skipped: false };
    }
    return { ok: true, relPath: fuzRel, skipped: true };
  } catch (err) {
    return {
      ok: false,
      reason: 'tts_failed',
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};
