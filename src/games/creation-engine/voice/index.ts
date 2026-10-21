/**
 * Creation Engine voice.
 *
 * Takes live under `Sound/Voice/<VoiceType>/` as `.fuz` (Xbox ADPCM + a
 * lip-sync track), one file per INFO response. Localized takes are written to
 * the mirrored path under the mod's localize directory.
 */
import {
  dedupeVoiceFiles,
  discoverVoiceFiles,
  resolveVoiceRootRel,
} from '../../../voice/discoverVoiceFiles';
import { pluginRelPath, resolveImportPackages } from '../../../modImport';
import { resolveModDirectoryFromPath } from '../../../formats/mcm';
import type { VoiceTake } from '../../contract';
import { BETHESDA_VOICE_MARKUP } from '../../../voice/prepareVoiceTtsText';
import {
  addExportableVoiceKeys,
  addInheritedExportableVoiceKeys,
} from '../../../voice/exportableVoiceKeys';
import {
  findImportedMasterMods,
  loadInheritedVoiceLookup,
} from '../../../voice/inheritedVoiceText';
import {
  loadVoiceSourcesDetailed,
  loadVoiceTranslations,
} from '../../../voice/loadVoiceTranslations';
import { findMasterBackedTake, loadVoiceWorkList } from '../../../voice/voiceWorkList';
import { voiceSpeakerKey } from '../../../voice/speakerReference';
import {
  synthesizeModVoiceLine,
  synthesizeModVoiceLineBuffers,
} from '../../../voice/synthesizeModVoiceLine';
import { outputLocalizedFuzRelPath } from '../../../voice/voiceFilePaths';
import { CONFIG } from '../../../config';
import { resolveVoicePackageContext } from '../../../web/voice/preview/context';
import { discoverVoiceEntries, findVoiceEntry } from '../../../web/voice/preview/voiceEntries';
import type { GameVoiceAdapter } from '../../contract';
import { loadCreationEngineVoiceCatalog } from './lineCatalog';
import { creationEngineVoiceKeyFromRelPath } from './takeFiles';
import { countCreationEngineVoiceWork, localizeCreationEngineVoice } from './localize';

export const creationEngineVoiceAdapter: GameVoiceAdapter = {
  sourceExtension: '.fuz',
  markupStyle: BETHESDA_VOICE_MARKUP,

  isLocalizedVoicePath: (normalizedRelPath) => /(^|\/)sound\/voice(\/|$)/.test(normalizedRelPath),

  voiceKeyFromRelPath: creationEngineVoiceKeyFromRelPath,

  localizedTakeRelPath: (entry) => outputLocalizedFuzRelPath(entry),

  discoverSourceTakes: ({ pluginPath }) => {
    const packageDir = resolveModDirectoryFromPath(pluginPath);
    return dedupeVoiceFiles(discoverVoiceFiles(packageDir, pluginRelPath(packageDir, pluginPath)));
  },

  listTakes: async (db, { modId, extractDir, pluginPath, srcLang, targetLang, speakerKey }) => {
    const pkg = resolveImportPackages(extractDir, targetLang, pluginPath)[0];
    if (!pkg) return [];

    const work = await loadVoiceWorkList(db, {
      modId,
      packageDir: pkg.packageDir,
      pluginPath: pkg.pluginPath,
      srcLang,
      tgtLang: targetLang,
    });
    const wanted = speakerKey?.trim() || '';

    const takes: VoiceTake[] = [];
    for (const { entry, row } of work.items) {
      const speaker = voiceSpeakerKey(entry, work.voiceRootRel);
      if (wanted && speaker !== wanted) continue;
      takes.push({
        entry,
        speakerKey: speaker,
        destRelPath: outputLocalizedFuzRelPath(entry),
        source: row.source,
        translation: row.translation,
      });
    }
    return takes;
  },

  loadExportableKeys: async (db, { modId, pluginPath, srcLang, targetLang }) => {
    const keys = new Set<string>();
    const [sources, translations, masterMods] = await Promise.all([
      loadVoiceSourcesDetailed(db, modId, srcLang),
      loadVoiceTranslations(db, modId, srcLang, targetLang),
      findImportedMasterMods(db, pluginPath, modId),
    ]);
    addExportableVoiceKeys(keys, sources, translations, BETHESDA_VOICE_MARKUP);

    if (masterMods.length > 0) {
      const inherited = await loadInheritedVoiceLookup(db, masterMods, srcLang, targetLang);
      addInheritedExportableVoiceKeys(keys, inherited, BETHESDA_VOICE_MARKUP);
    }
    return keys;
  },

  countLocalizeWork: (db, request) => countCreationEngineVoiceWork(db, request),

  localize: (db, request, sink) => localizeCreationEngineVoice(db, request, sink),

  synthesizeLine: (db, request) =>
    synthesizeModVoiceLine(db, {
      modId: request.modId,
      packageDir: request.packageDir,
      pluginPath: request.pluginPath,
      localizeDir: request.localizeDir,
      lineKey: request.lineKey,
      variant: request.variant,
      srcLang: request.srcLang,
      tgtLang: request.tgtLang,
      speakerKey: request.speakerKey,
      originPlugin: request.originPlugin,
    }),

  buildLinePreview: async (db, request) => {
    const built = await synthesizeModVoiceLineBuffers(db, {
      modId: request.modId,
      packageDir: request.packageDir,
      pluginPath: request.pluginPath,
      lineKey: request.lineKey,
      variant: request.variant,
      srcLang: request.srcLang,
      tgtLang: request.tgtLang,
      referenceMode: request.referenceMode,
      speakerKey: request.speakerKey,
      originPlugin: request.originPlugin,
    });
    if (!built.ok) return built;
    return {
      ok: true,
      destRelPath: built.fuzRel,
      payloadVersion: built.payloadVersion,
      artifact: 'fuz',
      audio: built.fuzData,
      voiceSimilarity: built.voiceSimilarity,
    };
  },

  findLineEntry: async (
    db,
    { modId, pluginPath, lineKey, variant, speakerKey, originPlugin, srcLang, targetLang },
  ) => {
    const ctx = resolveVoicePackageContext(pluginPath, CONFIG.defaultTgtLang);
    if (!ctx) return null;
    const own = findVoiceEntry(discoverVoiceEntries(ctx), lineKey, variant, {
      voiceRootRel: resolveVoiceRootRel(ctx.pluginRel),
      speakerKey,
      originPlugin,
    });
    if (own || !originPlugin) return own ?? null;
    const backed = await findMasterBackedTake(db, {
      modId,
      pluginPath,
      originPlugin,
      lineKey,
      variant,
      speakerKey,
      srcLang: srcLang ?? CONFIG.defaultSrcLang,
      tgtLang: targetLang ?? CONFIG.defaultTgtLang,
    });
    return backed?.entry ?? null;
  },

  loadLineCatalog: (db, request) => loadCreationEngineVoiceCatalog(db, request),
};
