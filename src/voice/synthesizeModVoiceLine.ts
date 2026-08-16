import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../db';
import type { GameType } from '../types';
import { pluginRelPath, toDiskPath, writeIfChanged } from '../modImport';
import { loadImportedMod } from '../modImport/importedMod';
import { ensureDir } from '../utils/file';
import { isDependencyUnavailableError } from '../pipeline/errors';
import { getJobRuntime } from '../pipeline/jobRuntime';
import { ensureDependencyHealthy } from '../pipeline/waitForHealthy';
import { checkTtsHealth, synthesizeWav, type TtsSynthesisParams } from '../tts/ttsClient';
import {
  dedupeVoiceFiles,
  discoverVoiceFiles,
  resolveVoiceRootRel,
  type VoiceFileEntry,
} from './discoverVoiceFiles';
import {
  loadVoiceSources,
  loadVoiceTranslations,
  lookupVoiceTranslation,
} from './loadVoiceTranslations';
import { migrateVoiceSpeakerRefsFromJsonIfNeeded } from './voiceSpeakerRefs';
import { groupVoiceFilesBySpeaker, voiceSpeakerKey } from './speakerReference';
import { pickVoiceTtsReference } from './pickVoiceTtsReference';
import { prepareReferenceAudio } from './prepareReferenceAudio';
import { prepareVoiceTtsText, voiceTtsSkipMessage } from './prepareVoiceTtsText';
import { buildVoicedFuzFromTtsWav } from './synthesizeVoicedFuz';
import { outputLocalizedFuzRelPath } from './voiceFilePaths';
import { loadVoiceSynthesisVersion, upsertVoiceSynthesisState } from './voiceSynthesisState';
import {
  isVoiceSynthesisCurrent,
  voiceTtsPayloadVersionFromPrepared,
} from './voiceTtsPayloadVersion';
import { resolveTtsBaseUrl, resolveTtsLanguage, type TtsReferenceMode } from './voiceToolPaths';
import { loadVoiceProjectSettings } from './voiceProjectSettings';

export type SynthesizeModVoiceLineResult =
  | { ok: true; relPath: string; skipped: boolean }
  | {
      ok: false;
      reason: 'line_not_found' | 'no_translation' | 'no_localize_dir' | 'non_speech' | 'tts_failed';
      message: string;
    };

export type SynthesizeModVoiceLineOptions = {
  modId: number;
  packageDir: string;
  pluginPath: string;
  formidLower6: string;
  variant: number;
  srcLang: string;
  tgtLang: string;
  game?: GameType;
  referenceMode?: TtsReferenceMode;
  ttsBaseUrl?: string;
  synthesis?: Partial<TtsSynthesisParams>;
};

export type SynthesizeModVoiceLineBuffersResult =
  | { ok: true; ttsWav: Buffer; fuzData: Buffer; fuzRel: string; payloadVersion: string }
  | { ok: false; reason: string; message: string };

/** Resolve absolute path to a localized `.fuz` under the mod localize tree. */
export const resolveLocalizedVoiceAbsPath = (
  localizeDir: string | null,
  entry: VoiceFileEntry,
): string | null => {
  if (!localizeDir) return null;
  return toDiskPath(localizeDir, outputLocalizedFuzRelPath(entry));
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

/** Synthesize one voiced line and return raw TTS WAV plus packed FUZ without writing to disk. */
export const synthesizeModVoiceLineBuffers = async (
  db: Tx,
  opts: SynthesizeModVoiceLineOptions,
): Promise<SynthesizeModVoiceLineBuffersResult> => {
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

  const voiceConfig = await loadVoiceProjectSettings(db);
  const referenceMode = opts.referenceMode ?? voiceConfig.referenceMode;
  const synthesis = { ...voiceConfig.synthesis, ...opts.synthesis };
  const ttsBaseUrl = opts.ttsBaseUrl ?? resolveTtsBaseUrl();
  const mod = await loadImportedMod(db, opts.modId);
  const game = opts.game ?? mod.game;

  // Line mode may auto-pick a speaker ref when the line clip is too short or too long.
  await migrateVoiceSpeakerRefsFromJsonIfNeeded(db, opts.modId);

  const fuzRel = outputLocalizedFuzRelPath(entry);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-voice-line-'));

  try {
    if (getJobRuntime()) await ensureDependencyHealthy('tts');
    else await checkTtsHealth(ttsBaseUrl);

    const workDir = path.join(tempRoot, `${entry.formidLower6}_${entry.variant}`);
    ensureDir(workDir);

    const voiceRootRel = resolveVoiceRootRel(pluginRel);
    const voiceSources = await loadVoiceSources(db, opts.modId, opts.srcLang);
    const speakerKey = voiceSpeakerKey(entry, voiceRootRel);
    const lineEnglishWav = await prepareReferenceAudio(entry, workDir);
    const siblings = speakerKey
      ? (groupVoiceFilesBySpeaker(voiceFiles, voiceRootRel)
          .get(speakerKey)
          ?.filter(
            (candidate) =>
              candidate.formidLower6 !== entry.formidLower6 || candidate.variant !== entry.variant,
          ) ?? [])
      : [];
    const picked = await pickVoiceTtsReference({
      db,
      modId: opts.modId,
      packageDir: opts.packageDir,
      pluginRelPath: pluginRel,
      speakerKey: speakerKey || null,
      entry,
      lineEnglishWav,
      lineSource: row.source,
      referenceMode,
      voiceSources,
      getSiblingEntries: () => siblings,
    });

    const prepared = prepareVoiceTtsText({
      lineSource: row.source,
      translation: row.translation,
      speakerSource: picked.referenceText,
      edid: row.edid,
    });
    if (prepared.action === 'skip') {
      return {
        ok: false,
        reason: 'non_speech',
        message: voiceTtsSkipMessage(prepared.reason),
      };
    }

    const payloadVersion = voiceTtsPayloadVersionFromPrepared(
      prepared,
      opts.tgtLang,
      prepared.speakerText,
    );

    const ttsWav = await synthesizeWav(prepared.text, picked.wavPath, {
      baseUrl: ttsBaseUrl,
      language: resolveTtsLanguage(opts.tgtLang),
      speakerText: prepared.speakerText,
      synthesis,
    });

    const built = await buildVoicedFuzFromTtsWav(
      game,
      ttsWav,
      workDir,
      entry.fileName,
      prepared.text,
      { includePreviewWav: true },
    );

    if (!built.previewWav) {
      return { ok: false, reason: 'tts_failed', message: 'TTS preview WAV was not built' };
    }

    return {
      ok: true,
      ttsWav: built.previewWav,
      fuzData: built.fuzData,
      fuzRel,
      payloadVersion,
    };
  } catch (err) {
    if (isDependencyUnavailableError(err)) throw err;
    return {
      ok: false,
      reason: 'tts_failed',
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};

/** Synthesize one voiced line into `_localize_{hash}/{lang}/` as a localized `.fuz` file. */
export const synthesizeModVoiceLine = async (
  db: Tx,
  opts: SynthesizeModVoiceLineOptions & { localizeDir: string; force?: boolean },
): Promise<SynthesizeModVoiceLineResult> => {
  if (!opts.localizeDir) {
    return {
      ok: false,
      reason: 'no_localize_dir',
      message: 'Mod import localize directory not found',
    };
  }

  const built = await synthesizeModVoiceLineBuffers(db, opts);
  if (!built.ok) {
    return {
      ok: false,
      reason:
        built.reason === 'line_not_found' ||
        built.reason === 'no_translation' ||
        built.reason === 'non_speech' ||
        built.reason === 'tts_failed'
          ? built.reason
          : 'tts_failed',
      message: built.message,
    };
  }

  const fuzDest = toDiskPath(opts.localizeDir, built.fuzRel);
  const storedVersion = await loadVoiceSynthesisVersion(
    db,
    opts.modId,
    opts.formidLower6,
    opts.variant,
    opts.tgtLang,
  );
  if (
    !opts.force &&
    isVoiceSynthesisCurrent(storedVersion, built.payloadVersion, fs.existsSync(fuzDest))
  ) {
    return { ok: true, relPath: built.fuzRel, skipped: true };
  }

  const baselinePath = fs.existsSync(fuzDest) ? fuzDest : null;
  if (!opts.force && writeIfChanged(fuzDest, built.fuzData, baselinePath)) {
    await upsertVoiceSynthesisState(db, {
      modId: opts.modId,
      formidLower6: opts.formidLower6,
      variant: opts.variant,
      targetLang: opts.tgtLang,
      ttsTextVersion: built.payloadVersion,
    });
    return { ok: true, relPath: built.fuzRel, skipped: false };
  }
  if (opts.force) {
    ensureDir(path.dirname(fuzDest));
    fs.writeFileSync(fuzDest, built.fuzData);
    await upsertVoiceSynthesisState(db, {
      modId: opts.modId,
      formidLower6: opts.formidLower6,
      variant: opts.variant,
      targetLang: opts.tgtLang,
      ttsTextVersion: built.payloadVersion,
    });
    return { ok: true, relPath: built.fuzRel, skipped: false };
  }
  return { ok: true, relPath: built.fuzRel, skipped: true };
};
