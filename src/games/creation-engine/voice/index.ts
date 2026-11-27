/**
 * Creation Engine voice.
 *
 * Takes live under `Sound/Voice/<Plugin>/<VoiceType>/`, one file per INFO
 * response and speaker. Localized takes are written to the mirrored path under
 * the mod's localize directory.
 *
 * What the file is — a `.fuz` named after its line, or Starfield's `.wem` named
 * by a WEM id with an `.ffxanim` beside it — is the title's `voice.takes`. The
 * adapter is built around that {@link VoiceTakeFormat} and hands it to every
 * shared voice module it calls.
 */
import { resolveVoiceRootRel } from '../../../voice/discoverVoiceFiles';
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
import { FUZ_TAKES, type VoiceTakeFormat } from '../../../voice/takeFormat';
import { CONFIG } from '../../../config';
import { resolveVoicePackageContext } from '../../../web/voice/preview/context';
import { discoverVoiceEntries, findVoiceEntry } from '../../../web/voice/preview/voiceEntries';
import type { GameVoiceAdapter } from '../../contract';
import type { EspRecordLayout } from '../../../formats/esp';
import { loadCreationEngineVoiceCatalog } from './lineCatalog';
import { loadCreationEngineLineDirections } from './lineDirections';
import { countCreationEngineVoiceWork, localizeCreationEngineVoice } from './localize';

/**
 * @param records - The title's record layout; omitted, plugins read as Fallout 4.
 */
export const createCreationEngineVoiceAdapter = (
  takes: VoiceTakeFormat = FUZ_TAKES,
  records?: EspRecordLayout,
): GameVoiceAdapter => ({
  sourceExtension: takes.extension,
  takes,
  markupStyle: BETHESDA_VOICE_MARKUP,

  isLocalizedVoicePath: (normalizedRelPath) => /(^|\/)sound\/voice(\/|$)/.test(normalizedRelPath),

  voiceKeyFromRelPath: takes.voiceKeyResolver(),

  localizedTakeRelPath: (entry) => takes.localizedRelPath(entry),

  discoverSourceTakes: ({ pluginPath }) => {
    const packageDir = resolveModDirectoryFromPath(pluginPath);
    return takes.discover(packageDir, pluginRelPath(packageDir, pluginPath));
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
      takes,
    });
    const wanted = speakerKey?.trim() || '';

    const list: VoiceTake[] = [];
    for (const { entry, row, referenceSource } of work.items) {
      const speaker = voiceSpeakerKey(entry, work.voiceRootRel);
      if (wanted && speaker !== wanted) continue;
      list.push({
        entry,
        speakerKey: speaker,
        destRelPath: takes.localizedRelPath(entry),
        source: row.source,
        translation: row.translation,
        ...(referenceSource ? { speakerSource: referenceSource } : {}),
      });
    }
    return list;
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

  countLocalizeWork: (db, request) => countCreationEngineVoiceWork(db, request, takes),

  localize: (db, request, sink) => localizeCreationEngineVoice(db, request, sink, takes),

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
      takes,
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
      takes,
      ...(request.effortTag !== undefined ? { effortTag: request.effortTag } : {}),
    });
    if (!built.ok) return built;
    return {
      ok: true,
      destRelPath: built.takeRel,
      payloadVersion: built.payloadVersion,
      artifact: takes.artifact,
      audio: built.take.data,
      ...(built.take.sidecars.length > 0 ? { sidecars: built.take.sidecars } : {}),
      voiceSimilarity: built.voiceSimilarity,
    };
  },

  findLineEntry: async (
    db,
    { modId, pluginPath, lineKey, variant, speakerKey, originPlugin, srcLang, targetLang },
  ) => {
    const ctx = resolveVoicePackageContext(pluginPath, CONFIG.defaultTgtLang);
    if (!ctx) return null;
    const own = findVoiceEntry(discoverVoiceEntries(ctx, takes), lineKey, variant, {
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
      takes,
    });
    return backed?.entry ?? null;
  },

  loadLineCatalog: (db, request) => loadCreationEngineVoiceCatalog(db, request, takes),

  loadLineDirections: (pluginPath) => loadCreationEngineLineDirections(pluginPath, records),
});

/** The adapter of every title that keeps the default `.fuz` takes. */
export const creationEngineVoiceAdapter: GameVoiceAdapter = createCreationEngineVoiceAdapter();
