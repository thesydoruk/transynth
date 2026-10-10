/**
 * The Witcher 3 voice adapter.
 *
 * Takes are rows of the `<lang>pc.w3speech` containers the import copied, one
 * per line and keyed by the line's string id; `voice_clips` holds the join.
 * Every line is cloned from its own take (see `synthesizeLine.ts`) and gets a
 * mouth animation from the mimic model, or its original one stretched.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../../../db';
import { loadImportedMod } from '../../../modImport/importedMod';
import { resolveModImportExtractRoot } from '../../../modStorage/paths';
import { getJobRuntime } from '../../../pipeline/jobRuntime';
import { ensureDependencyHealthy } from '../../../pipeline/waitForHealthy';
import { checkTtsHealth } from '../../../tts/ttsClient';
import type { VoiceFileEntry } from '../../../voice/discoverVoiceFiles';
import { loadDialogSpeakerGenders, loadDialogSpeakerNames } from '../../../voice/dialogSpeakerMeta';
import { loadVoiceProjectSettings } from '../../../voice/voiceProjectSettings';
import { loadVoiceSpeakerRefs } from '../../../voice/voiceSpeakerRefs';
import {
  loadVoiceSimilarityMap,
  loadVoiceSynthesisVersionMap,
} from '../../../voice/voiceSynthesisState';
import { voiceTtsPayloadVersionFromPrepared } from '../../../voice/voiceTtsPayloadVersion';
import { resolveTtsBaseUrl, type TtsReferenceMode } from '../../../voice/voiceToolPaths';
import {
  fillVoiceLocalizeDirFromImport,
  resolveVoicePackageContext,
} from '../../../web/voice/preview/context';
import {
  buildTranslationAudioSet,
  hasTranslationAudio,
} from '../../../web/voice/preview/translationAudioIndex';
import type { GameVoiceAdapter, VoiceTake } from '../../contract';
import { W3_UNKNOWN_SPEAKER } from './clips';
import { loadW3VoiceLines, w3VoiceTextMaps, type W3VoiceLine } from './lines';
import { countW3VoiceWork, localizeW3Voice } from './localize';
import { WITCHER3_VOICE_MARKUP } from './markup';
import { loadW3MimicModel, w3MimicModelPath } from './mimicModel';
import { buildW3ReferenceContext } from './references';
import {
  prepareW3VoiceText,
  synthesizeW3LineBuffers,
  synthesizeW3VoiceLine,
} from './synthesizeLine';
import {
  materializeW3SourceTake,
  readW3SourceTake,
  W3_VOICE_VARIANT,
  w3LocalizedTakePaths,
  w3SourceCacheDir,
  w3SourceTakeEntry,
  w3VoiceKeyFromFileName,
} from './takes';

const entryOf = (modId: number, line: W3VoiceLine): VoiceFileEntry =>
  w3SourceTakeEntry(line.relPath, w3SourceCacheDir(modId))!;

const lineByKey = async (
  db: Tx,
  modId: number,
  srcLang: string,
  tgtLang: string,
  lineKey: string,
): Promise<W3VoiceLine | null> => {
  const lines = await loadW3VoiceLines(db, modId, srcLang, tgtLang, {
    onlyKeys: new Set([`${lineKey}:${W3_VOICE_VARIANT}`]),
  });
  return lines[0] ?? null;
};

const loadSingleLineContext = async (
  db: Tx,
  request: { modId: number; pluginPath: string; lineKey: string; srcLang: string; tgtLang: string },
) => {
  const extractRoot = resolveModImportExtractRoot(request.pluginPath);
  if (!extractRoot)
    return {
      ok: false as const,
      reason: 'plugin_missing' as const,
      message: 'Mod files not found',
    };
  const line = await lineByKey(
    db,
    request.modId,
    request.srcLang,
    request.tgtLang,
    request.lineKey,
  );
  if (!line)
    return {
      ok: false as const,
      reason: 'line_not_found' as const,
      message: 'Voice line not found',
    };
  if (!line.translation) {
    return {
      ok: false as const,
      reason: 'no_translation' as const,
      message: 'Line has no translation',
    };
  }
  const prepared = prepareW3VoiceText(line);
  if (prepared.action !== 'synthesize') {
    return {
      ok: false as const,
      reason: 'non_speech' as const,
      message: 'Line is not synthesizable',
    };
  }
  const original = readW3SourceTake(extractRoot, line.relPath);
  if (!original)
    return { ok: false as const, reason: 'line_not_found' as const, message: 'Take not found' };
  const ttsBaseUrl = resolveTtsBaseUrl();
  const mod = await loadImportedMod(db, request.modId);
  const settings = await loadVoiceProjectSettings(db, mod.game);
  if (getJobRuntime()) await ensureDependencyHealthy('tts');
  else await checkTtsHealth(ttsBaseUrl);
  // The speaker's own takes, for the reference picker.
  const speakerLines = await loadW3VoiceLines(db, request.modId, request.srcLang, request.tgtLang, {
    speakerKey: line.speakerKey,
  });
  const reference = (mode: TtsReferenceMode) =>
    buildW3ReferenceContext({
      mode,
      extractRoot,
      cacheDir: w3SourceCacheDir(request.modId),
      lines: speakerLines,
    });
  return {
    ok: true as const,
    line,
    prepared,
    original,
    ttsBaseUrl,
    synthesis: settings.synthesis,
    referenceMode: settings.referenceMode,
    reference,
  };
};

export const witcher3VoiceAdapter: GameVoiceAdapter = {
  sourceExtension: '.wav',
  markupStyle: WITCHER3_VOICE_MARKUP,

  isLocalizedVoicePath: (normalizedRelPath) => /\.w3speech$/.test(normalizedRelPath),

  voiceKeyFromFileName: w3VoiceKeyFromFileName,

  localizedTakeRelPath: (entry) => {
    const hash = entry.relPath.lastIndexOf('#');
    return w3LocalizedTakePaths(entry.relPath.slice(0, hash), Number(entry.lineKey)).wav;
  },

  // Takes are rows of a container, listed from `voice_clips` rather than found on disk.
  discoverSourceTakes: () => [],

  listTakes: async (db, { modId, srcLang, targetLang, speakerKey }) => {
    const lines = await loadW3VoiceLines(db, modId, srcLang, targetLang);
    return lines
      .filter((line) => !speakerKey || line.speakerKey === speakerKey)
      .map(
        (line): VoiceTake => ({
          entry: entryOf(modId, line),
          speakerKey: line.speakerKey,
          destRelPath: w3LocalizedTakePaths(line.container, line.id).wav,
          source: line.source,
          translation: line.translation,
        }),
      );
  },

  loadExportableKeys: async (db, { modId, srcLang, targetLang }) => {
    const lines = await loadW3VoiceLines(db, modId, srcLang, targetLang, { translatedOnly: true });
    return new Set(
      lines
        .filter((line) => prepareW3VoiceText(line).action === 'synthesize')
        .map((line) => `${line.id}:${W3_VOICE_VARIANT}`),
    );
  },

  countLocalizeWork: countW3VoiceWork,
  localize: localizeW3Voice,

  synthesizeLine: async (db, request) => {
    const loaded = await loadSingleLineContext(db, request);
    if (!loaded.ok) return loaded;
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'w3-line-'));
    const model = loadW3MimicModel();
    try {
      const result = await synthesizeW3VoiceLine(loaded.line, loaded.original, {
        db,
        modId: request.modId,
        localizeDir: request.localizeDir,
        tempRoot,
        ttsBaseUrl: loaded.ttsBaseUrl,
        synthesis: loaded.synthesis,
        tgtLang: request.tgtLang,
        model,
        modelPath: model ? w3MimicModelPath() : null,
        reference: loaded.reference(loaded.referenceMode),
        force: true,
        storedVersions: await loadVoiceSynthesisVersionMap(db, request.modId, request.tgtLang),
      });
      if (result.kind === 'warning')
        return { ok: false, reason: 'tts_failed', message: result.message };
      return { ok: true, relPath: result.relPath, skipped: result.kind === 'skipped' };
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  },

  buildLinePreview: async (db, request) => {
    const loaded = await loadSingleLineContext(db, request);
    if (!loaded.ok) return loaded;
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'w3-preview-'));
    try {
      const built = await synthesizeW3LineBuffers(loaded.line, loaded.original, loaded.prepared, {
        ttsBaseUrl: loaded.ttsBaseUrl,
        synthesis: loaded.synthesis,
        tgtLang: request.tgtLang,
        model: null,
        modelPath: null,
        reference: loaded.reference(request.referenceMode),
        db,
        modId: request.modId,
        tempRoot,
      });
      return {
        ok: true,
        destRelPath: w3LocalizedTakePaths(loaded.line.container, loaded.line.id).wav,
        payloadVersion: voiceTtsPayloadVersionFromPrepared(loaded.prepared, request.tgtLang),
        artifact: 'wav',
        audio: built.wav,
        speakerKey: loaded.line.speakerKey,
        voiceSimilarity: built.voiceSimilarity,
      };
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  },

  findLineEntry: async (db, { modId, pluginPath, lineKey, variant }) => {
    if (variant !== W3_VOICE_VARIANT) return null;
    const extractRoot = resolveModImportExtractRoot(pluginPath);
    if (!extractRoot) return null;
    const mod = await loadImportedMod(db, modId);
    const line = await lineByKey(db, modId, mod.srcLang ?? 'en', mod.srcLang ?? 'en', lineKey);
    if (!line) return null;
    const entry = entryOf(modId, line);
    return materializeW3SourceTake(extractRoot, entry) ? entry : null;
  },

  loadLineCatalog: async (db, { modId, pluginPath, srcLang, targetLang }) => {
    const ctx = resolveVoicePackageContext(pluginPath, targetLang);
    if (!ctx)
      return { ok: false, reason: 'plugin_missing', message: 'Mod files not found on disk' };
    await fillVoiceLocalizeDirFromImport(db, modId, ctx);
    const lines = await loadW3VoiceLines(db, modId, srcLang, targetLang);
    if (lines.length === 0) {
      return { ok: false, reason: 'no_voice_files', message: 'This mod has no voice' };
    }
    const [speakerRefs, voiceSimilarities, speakerNames, speakerGenders] = await Promise.all([
      loadVoiceSpeakerRefs(db, modId),
      loadVoiceSimilarityMap(db, modId, targetLang),
      loadDialogSpeakerNames(db, modId),
      loadDialogSpeakerGenders(db, modId),
    ]);
    const text = w3VoiceTextMaps(lines);
    const translationAudio = buildTranslationAudioSet(ctx.localizeDir, {
      voiceKeyFromFileName: w3VoiceKeyFromFileName,
    });
    const speakerOf = new Map(lines.map((line) => [String(line.id), line.speakerKey]));
    return {
      ok: true,
      modId,
      ctx,
      voiceRootRel: '',
      voiceFiles: lines.map((line) => entryOf(modId, line)),
      sources: text.sources,
      translations: text.translations,
      inheritedLookup: null,
      sourceFormids: text.sourceFormids,
      speakerRefs,
      folderGenders: speakerGenders,
      voiceSimilarities,
      markupStyle: WITCHER3_VOICE_MARKUP,
      speakerKeyOf: (entry) => speakerOf.get(entry.lineKey) ?? W3_UNKNOWN_SPEAKER,
      speakerDisplayName: (speakerKey) => speakerNames.get(speakerKey) ?? speakerKey,
      hasLocalizedTake: (entry) =>
        hasTranslationAudio(translationAudio, entry.lineKey, entry.variant),
    };
  },
};
