/**
 * Disco Elysium voice.
 *
 * Takes are loose `.wav` under `Audio/` in each language folder, named after
 * the lockit key rather than a FormID; the import hashes each stem into a
 * synthetic FormID so the rest of the app can key lines the same way it does
 * for a Creation Engine mod.
 */
import { addExportableVoiceKeys } from '../../../voice/exportableVoiceKeys';
import { DISCO_VOICE_MARKUP } from './markup';
import type { GameVoiceAdapter } from '../../contract';
import { discoVoiceSpeakerKey, discoverDiscoVoiceFiles } from './discoverDiscoVoiceFiles';
import { loadDiscoVoiceSources } from './loadDiscoVoiceSources';
import { loadDiscoVoiceTranslations } from './loadDiscoVoiceTranslations';
import { loadDiscoVoiceCatalog } from './lineCatalog';
import { reindexDiscoVoiceTakes } from './reindexVoiceTakes';
import { countDiscoVoiceLocalizeWork, localizeDiscoVoicePackage } from './localizeDiscoVoice';
import { resolveDiscoClipEntryByFormid, resolveDiscoVoiceFilesFromClips } from './resolveClipEntry';
import { resolveDiscoVoiceExtractRoot } from './discoverDiscoVoiceFiles';
import {
  synthesizeDiscoVoiceLine,
  synthesizeDiscoVoiceLineBuffers,
} from './synthesizeDiscoVoiceLine';
import { lookupVoiceTranslation } from '../../../voice/loadVoiceTranslations';
import type { VoiceTake } from '../../contract';
import { discoVoiceKeyFromFileName } from './takeFiles';
import { outputLocalizedWavRelPath } from './voicePaths';

export const discoVoiceAdapter: GameVoiceAdapter = {
  sourceExtension: '.wav',
  markupStyle: DISCO_VOICE_MARKUP,

  isLocalizedVoicePath: (normalizedRelPath) => /(^|\/)audio(\/|$)/.test(normalizedRelPath),

  voiceKeyFromFileName: discoVoiceKeyFromFileName,

  localizedTakeRelPath: (entry) => outputLocalizedWavRelPath(entry),

  discoverSourceTakes: ({ extractDir }) => discoverDiscoVoiceFiles(extractDir),

  listTakes: async (db, { modId, extractDir, srcLang, targetLang, speakerKey }) => {
    const wanted = speakerKey?.trim() || '';
    const [translations, voiceFiles] = await Promise.all([
      loadDiscoVoiceTranslations(
        db,
        modId,
        srcLang,
        targetLang,
        extractDir,
        wanted ? { speakerKey: wanted } : {},
      ),
      resolveDiscoVoiceFilesFromClips(db, modId, extractDir, wanted || undefined),
    ]);

    const takes: VoiceTake[] = [];
    for (const entry of voiceFiles) {
      const speaker = discoVoiceSpeakerKey(entry);
      if (wanted && speaker !== wanted) continue;
      const row = lookupVoiceTranslation(translations, entry.lineKey, entry.variant);
      takes.push({
        entry,
        speakerKey: speaker,
        destRelPath: outputLocalizedWavRelPath(entry),
        source: row?.source ?? '',
        translation: row?.translation ?? '',
      });
    }
    return takes;
  },

  loadExportableKeys: async (db, { modId, srcLang, targetLang, extractRoot }) => {
    const keys = new Set<string>();
    const [sources, translations] = await Promise.all([
      loadDiscoVoiceSources(db, modId, srcLang, extractRoot),
      loadDiscoVoiceTranslations(db, modId, srcLang, targetLang, extractRoot),
    ]);
    addExportableVoiceKeys(keys, sources, translations, DISCO_VOICE_MARKUP);
    return keys;
  },

  countLocalizeWork: (db, request) =>
    countDiscoVoiceLocalizeWork(
      db,
      request.modId,
      request.extractDir,
      request.srcLang,
      request.tgtLang,
      request.scope,
      request.onlyKeys,
      request.speakerKey,
    ),

  localize: (db, request, sink) =>
    localizeDiscoVoicePackage(
      db,
      {
        extractDir: request.extractDir,
        modId: request.modId,
        game: request.game,
        srcLang: request.srcLang,
        tgtLang: request.tgtLang,
        ttsBaseUrl: request.ttsBaseUrl,
        synthesis: request.synthesis,
        referenceMode: request.referenceMode,
        force: request.force,
        scope: request.scope,
        onlyKeys: request.onlyKeys,
        speakerKey: request.speakerKey,
        limit: request.limit,
        dryRun: request.dryRun,
        shouldCancel: request.shouldCancel,
        signal: request.signal,
        onEligibleStep: request.onEligibleStep,
      },
      sink.written,
      sink.skipped,
      sink.warnings,
    ),

  synthesizeLine: (db, request) =>
    synthesizeDiscoVoiceLine(db, {
      modId: request.modId,
      pluginPath: request.pluginPath,
      localizeDir: request.localizeDir,
      lineKey: request.lineKey,
      variant: request.variant,
      srcLang: request.srcLang,
      tgtLang: request.tgtLang,
      force: true,
    }),

  buildLinePreview: async (db, request) => {
    const built = await synthesizeDiscoVoiceLineBuffers(db, {
      modId: request.modId,
      pluginPath: request.pluginPath,
      lineKey: request.lineKey,
      variant: request.variant,
      srcLang: request.srcLang,
      tgtLang: request.tgtLang,
      referenceMode: request.referenceMode,
    });
    if (!built.ok) return built;
    return {
      ok: true,
      destRelPath: built.wavRel,
      payloadVersion: built.payloadVersion,
      artifact: 'wav',
      audio: built.ttsWav,
      speakerKey: built.speakerKey,
      voiceSimilarity: built.voiceSimilarity,
    };
  },

  findLineEntry: async (db, { modId, pluginPath, lineKey, variant }) => {
    const extractRoot = resolveDiscoVoiceExtractRoot(pluginPath);
    if (!extractRoot) return null;
    const found = await resolveDiscoClipEntryByFormid(db, modId, extractRoot, lineKey);
    if (!found || found.entry.variant !== variant) return null;
    return found.entry;
  },

  loadLineCatalog: (db, request) => loadDiscoVoiceCatalog(db, request),

  // A `.wav` here names its actor and conversation, not its lockit row, so the
  // take↔line mapping is inferred at import and can be re-derived later.
  reindexTakes: (db, request) => reindexDiscoVoiceTakes(db, request),
};
