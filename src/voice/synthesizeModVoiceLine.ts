import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../db';
import { pluginRelPath, toDiskPath, writeIfChanged } from '../modImport';
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
import { outputTtsWavRelPath } from './voiceFilePaths';
import {
  resolveTtsBaseUrl,
  resolveTtsLanguage,
  resolveTtsReferenceMode,
  type TtsReferenceMode,
} from './voiceToolPaths';

export type SynthesizeModVoiceLineResult =
  | { ok: true; relPath: string; skipped: boolean }
  | {
      ok: false;
      reason: 'line_not_found' | 'no_translation' | 'no_localize_dir' | 'tts_failed';
      message: string;
    };

export const resolveTtsWavAbsPath = (
  localizeDir: string | null,
  entry: VoiceFileEntry,
): string | null => {
  if (!localizeDir) return null;
  return toDiskPath(localizeDir, outputTtsWavRelPath(entry));
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

/** Synthesize one voiced line into `localize/` as raw TTS WAV. */
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

  const referenceMode = opts.referenceMode ?? resolveTtsReferenceMode();
  const xttsBaseUrl = opts.xttsBaseUrl ?? resolveTtsBaseUrl();
  await checkXttsHealth(xttsBaseUrl);

  if (referenceMode === 'speaker') {
    await migrateVoiceSpeakerRefsFromJsonIfNeeded(db, opts.modId);
  }

  const ttsWavRel = outputTtsWavRelPath(entry);
  const ttsWavDest = toDiskPath(opts.localizeDir, ttsWavRel);
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
      language: resolveTtsLanguage(),
      speakerText: referenceText ?? undefined,
    });

    const baselinePath = fs.existsSync(ttsWavDest) ? ttsWavDest : null;
    if (!opts.force && writeIfChanged(ttsWavDest, ttsWav, baselinePath)) {
      return { ok: true, relPath: ttsWavRel, skipped: false };
    }
    if (opts.force) {
      ensureDir(path.dirname(ttsWavDest));
      fs.writeFileSync(ttsWavDest, ttsWav);
      return { ok: true, relPath: ttsWavRel, skipped: false };
    }
    return { ok: true, relPath: ttsWavRel, skipped: true };
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
