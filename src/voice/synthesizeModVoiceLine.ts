import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../db';
import type { GameType } from '../types';
import type { TtsBackend } from '../tts/xttsClient';
import type { XttsSynthesisParams } from '../tts/xttsSynthesisParams';
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
} from './speakerReference';
import { prepareReferenceAudio } from './prepareReferenceAudio';
import { prepareVoiceTtsText, voiceTtsSkipMessage } from './prepareVoiceTtsText';
import { buildVoicedFuzFromTtsWav } from './synthesizeVoicedFuz';
import { outputLocalizedFuzRelPath } from './voiceFilePaths';
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
  backend?: TtsBackend;
  referenceMode?: TtsReferenceMode;
  xttsBaseUrl?: string;
  synthesis?: Partial<XttsSynthesisParams>;
};

export type SynthesizeModVoiceLineBuffersResult =
  | { ok: true; ttsWav: Buffer; fuzData: Buffer; fuzRel: string }
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
  const backend = opts.backend ?? voiceConfig.backend;
  const synthesis = { ...voiceConfig.synthesis, ...opts.synthesis };
  const xttsBaseUrl = opts.xttsBaseUrl ?? resolveTtsBaseUrl();
  const mod = await loadImportedMod(db, opts.modId);
  const game = opts.game ?? mod.game;

  if (referenceMode === 'speaker') {
    await migrateVoiceSpeakerRefsFromJsonIfNeeded(db, opts.modId);
  }

  const fuzRel = outputLocalizedFuzRelPath(entry);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-voice-line-'));

  try {
    await checkXttsHealth(xttsBaseUrl);

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

    // Skip non-speech / interject stubs; strip *...* from translation and speaker_text.
    const prepared = prepareVoiceTtsText({
      lineSource: row.source,
      translation: row.translation,
      speakerSource: referenceText,
      edid: row.edid,
    });
    if (prepared.action === 'skip') {
      return {
        ok: false,
        reason: 'non_speech',
        message: voiceTtsSkipMessage(prepared.reason),
      };
    }

    const ttsWav = await synthesizeXttsWav(prepared.text, finalReferenceWav, {
      baseUrl: xttsBaseUrl,
      backend,
      language: resolveTtsLanguage(opts.tgtLang),
      speakerText: prepared.speakerText,
      synthesis,
    });

    const fuzData = await buildVoicedFuzFromTtsWav(
      game,
      ttsWav,
      workDir,
      entry.fileName,
      prepared.text,
    );

    return { ok: true, ttsWav, fuzData, fuzRel };
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
  const baselinePath = fs.existsSync(fuzDest) ? fuzDest : null;
  if (!opts.force && writeIfChanged(fuzDest, built.fuzData, baselinePath)) {
    return { ok: true, relPath: built.fuzRel, skipped: false };
  }
  if (opts.force) {
    ensureDir(path.dirname(fuzDest));
    fs.writeFileSync(fuzDest, built.fuzData);
    return { ok: true, relPath: built.fuzRel, skipped: false };
  }
  return { ok: true, relPath: built.fuzRel, skipped: true };
};
