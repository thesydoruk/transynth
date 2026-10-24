/**
 * The editor's voice catalog for a Creation Engine mod.
 *
 * Takes live in `Sound/Voice/<VoiceType>/<FormID>_<n>.fuz` next to the plugin;
 * their text comes from the INFO records the import stored, plus any master
 * plugin the mod inherits lines from.
 */
import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { resolveVoiceRootRel } from '../../../voice/discoverVoiceFiles';
import {
  findImportedMasterMods,
  loadInheritedVoiceLookup,
  type InheritedVoiceLookup,
} from '../../../voice/inheritedVoiceText';
import type { VoiceLineCatalogResult } from '../../../voice/lineCatalog';
import {
  loadVoiceSourcesDetailed,
  loadVoiceTranslations,
} from '../../../voice/loadVoiceTranslations';
import { persistBethesdaVoiceClips } from '../../../voice/persistBethesdaVoiceClips';
import { BETHESDA_VOICE_MARKUP } from '../../../voice/prepareVoiceTtsText';
import { voiceSpeakerKey } from '../../../voice/speakerReference';
import { collectVoiceSourceFormids } from '../../../voice/voiceSourceFormids';
import { loadVoiceSpeakerRefs } from '../../../voice/voiceSpeakerRefs';
import { loadVoiceSimilarityMap } from '../../../voice/voiceSynthesisState';
import { loadVoiceWorkList } from '../../../voice/voiceWorkList';
import {
  fillVoiceLocalizeDirFromImport,
  resolveVoicePackageContext,
} from '../../../web/voice/preview/context';
import { loadVoiceFolderGenders } from '../../../web/voice/preview/speakerGender';
import { creationEngineVoiceKeyFromRelPath } from './takeFiles';
import {
  buildTranslationAudioSet,
  voiceEntryAudioKey,
} from '../../../web/voice/preview/translationAudioIndex';
import {
  discoverVoiceEntries,
  formatVoiceSpeakerLabel,
  loadSpeakerNamesFromDb,
} from '../../../web/voice/preview/voiceEntries';

/**
 * Nate and Nora share an INFO FormID, so for those two the voice folder — not
 * the FormID — is what tells the speakers apart.
 */
const PLAYER_VOICE_LABEL_RE = /^Player (Female|Male)$/i;

const hasVoiceClips = async (db: Tx, modId: number): Promise<boolean> => {
  const { rows } = await db.query(`SELECT 1 FROM voice_clips WHERE mod_id = $1 LIMIT 1`, [modId]);
  return rows.length > 0;
};

export const loadCreationEngineVoiceCatalog = async (
  db: Tx,
  request: { modId: number; pluginPath: string; srcLang: string; targetLang: string },
): Promise<VoiceLineCatalogResult> => {
  const { modId, pluginPath, srcLang, targetLang } = request;

  const ctx = resolveVoicePackageContext(pluginPath, targetLang);
  if (!ctx)
    return { ok: false, reason: 'plugin_missing', message: 'Plugin file not found on disk' };
  await fillVoiceLocalizeDirFromImport(db, modId, ctx);

  // The import indexes voice clips; mods imported before that table existed get one
  // backfill here. Rewriting the index on every catalog build (every new take bumps the
  // revision) cost a minute of UPDATE/DELETE/INSERT over a hundred thousand rows.
  try {
    if (!(await hasVoiceClips(db, modId))) await persistBethesdaVoiceClips(db, modId, srcLang);
  } catch (err) {
    log.warn(
      `Voice clips: ensure failed for mod ${modId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Own takes, plus the masters' takes for lines this mod overrides with a
  // different translation — the editor dubs those into this mod's tree too.
  const work = await loadVoiceWorkList(db, {
    modId,
    packageDir: ctx.packageDir,
    pluginPath: ctx.pluginPath,
    srcLang,
    tgtLang: targetLang,
  });
  const voiceFiles = [
    ...discoverVoiceEntries(ctx),
    ...work.items.filter((item) => item.masterBacked).map((item) => item.entry),
  ];
  if (voiceFiles.length === 0) {
    return { ok: false, reason: 'no_voice_files', message: 'No voice files found for this mod' };
  }

  const voiceRootRel = resolveVoiceRootRel(ctx.pluginRel);
  const translationAudio = buildTranslationAudioSet(ctx.localizeDir, {
    voiceKeyFromRelPath: creationEngineVoiceKeyFromRelPath,
  });

  const [
    sources,
    translations,
    masterMods,
    dbSpeakerNames,
    speakerRefs,
    folderGenders,
    voiceSimilarities,
  ] = await Promise.all([
    loadVoiceSourcesDetailed(db, modId, srcLang),
    loadVoiceTranslations(db, modId, srcLang, targetLang),
    findImportedMasterMods(db, pluginPath, modId),
    loadSpeakerNamesFromDb(db, modId),
    loadVoiceSpeakerRefs(db, modId),
    loadVoiceFolderGenders(db, modId),
    loadVoiceSimilarityMap(db, modId, targetLang),
  ]);

  let inheritedLookup: InheritedVoiceLookup | null = null;
  if (masterMods.length > 0) {
    inheritedLookup = await loadInheritedVoiceLookup(db, masterMods, srcLang, targetLang);
    log.debug(
      `Voice list mod=${modId}: inherited lookup from ${masterMods.map((m) => m.pluginName).join(', ')}`,
    );
  }

  return {
    ok: true,
    modId,
    ctx,
    voiceRootRel,
    voiceFiles,
    sources,
    translations,
    inheritedLookup,
    sourceFormids: collectVoiceSourceFormids(sources, translations, inheritedLookup),
    speakerRefs,
    folderGenders,
    voiceSimilarities,
    markupStyle: BETHESDA_VOICE_MARKUP,
    speakerKeyOf: (entry) => voiceSpeakerKey(entry, voiceRootRel) || 'Unknown',
    speakerDisplayName: (speakerKey, lineKey) => {
      const folderLabel = formatVoiceSpeakerLabel(speakerKey);
      if (PLAYER_VOICE_LABEL_RE.test(folderLabel)) return folderLabel;
      return dbSpeakerNames.get(lineKey.toUpperCase()) || folderLabel;
    },
    hasLocalizedTake: (entry) => translationAudio.has(voiceEntryAudioKey(entry)),
    masterBackedOf: (entry) => work.masterOfEntry(entry)?.master ?? null,
  };
};
