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
  lookupVoiceTranslation,
} from '../../../voice/loadVoiceTranslations';
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
import { creationEngineVoiceKeyFromFileName } from './takeFiles';
import { countCreationEngineVoiceWork, localizeCreationEngineVoice } from './localize';

export const creationEngineVoiceAdapter: GameVoiceAdapter = {
  sourceExtension: '.fuz',
  markupStyle: BETHESDA_VOICE_MARKUP,

  isLocalizedVoicePath: (normalizedRelPath) => /(^|\/)sound\/voice(\/|$)/.test(normalizedRelPath),

  voiceKeyFromFileName: creationEngineVoiceKeyFromFileName,

  localizedTakeRelPath: (entry) => outputLocalizedFuzRelPath(entry),

  discoverSourceTakes: ({ pluginPath }) => {
    const packageDir = resolveModDirectoryFromPath(pluginPath);
    return dedupeVoiceFiles(discoverVoiceFiles(packageDir, pluginRelPath(packageDir, pluginPath)));
  },

  listTakes: async (db, { modId, extractDir, pluginPath, srcLang, targetLang, speakerKey }) => {
    const pkg = resolveImportPackages(extractDir, targetLang, pluginPath)[0];
    if (!pkg) return [];

    const pluginRel = pluginRelPath(pkg.packageDir, pkg.pluginPath);
    const voiceRootRel = resolveVoiceRootRel(pluginRel);
    const translations = await loadVoiceTranslations(db, modId, srcLang, targetLang);
    const wanted = speakerKey?.trim() || '';

    const takes: VoiceTake[] = [];
    for (const entry of dedupeVoiceFiles(discoverVoiceFiles(pkg.packageDir, pluginRel))) {
      const speaker = voiceSpeakerKey(entry, voiceRootRel);
      if (wanted && speaker !== wanted) continue;
      const row = lookupVoiceTranslation(translations, entry.lineKey, entry.variant);
      takes.push({
        entry,
        speakerKey: speaker,
        destRelPath: outputLocalizedFuzRelPath(entry),
        source: row?.source ?? '',
        translation: row?.translation ?? '',
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

  findLineEntry: async (_db, { pluginPath, lineKey, variant, speakerKey }) => {
    const ctx = resolveVoicePackageContext(pluginPath, CONFIG.defaultTgtLang);
    if (!ctx) return null;
    return (
      findVoiceEntry(discoverVoiceEntries(ctx), lineKey, variant, {
        voiceRootRel: resolveVoiceRootRel(ctx.pluginRel),
        speakerKey,
      }) ?? null
    );
  },

  loadLineCatalog: (db, request) => loadCreationEngineVoiceCatalog(db, request),
};
