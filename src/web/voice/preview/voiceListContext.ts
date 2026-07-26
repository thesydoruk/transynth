import type { Tx } from '../../../db';
import type { GameType } from '../../../types';
import { log } from '../../../logger';
import { CONFIG } from '../../../config';
import type { VoiceFileEntry } from '../../../voice/discoverVoiceFiles';
import { resolveVoiceRootRel } from '../../../voice/discoverVoiceFiles';
import {
  loadVoiceSourcesDetailed,
  loadVoiceTranslations,
  type VoiceTranslationRow,
} from '../../../voice/loadVoiceTranslations';
import {
  findImportedMasterMods,
  loadInheritedVoiceLookup,
  type InheritedVoiceLookup,
} from '../../../voice/inheritedVoiceText';
import { resolveModStoredPath } from '../../../modStorage';
import { loadVoiceSpeakerRefs, type VoiceSpeakerRefMap } from '../../../voice/voiceSpeakerRefs';
import { resolveVoicePackageContext, type VoicePackageContext } from './context';
import { loadVoiceFolderGenders, type VoiceFolderGender } from './speakerGender';
import { discoverVoiceEntries, loadSpeakerNamesFromDb } from './voiceEntries';
import { buildTranslationAudioSet } from './translationAudioIndex';

export type VoiceListContextError = {
  ok: false;
  reason: 'mod_not_found' | 'no_plugin_path' | 'plugin_missing' | 'no_voice_files';
  message: string;
};

export type VoiceListContext = {
  modId: number;
  ctx: VoicePackageContext;
  voiceRootRel: string;
  voiceFiles: VoiceFileEntry[];
  sources: Awaited<ReturnType<typeof loadVoiceSourcesDetailed>>;
  translations: Map<string, VoiceTranslationRow>;
  inheritedLookup: InheritedVoiceLookup | null;
  dbSpeakerNames: Map<string, string>;
  speakerRefs: VoiceSpeakerRefMap;
  folderGenders: Map<string, VoiceFolderGender>;
  translationAudio: Set<string>;
};

export type VoiceListContextResult = VoiceListContextError | { ok: true; data: VoiceListContext };

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { loadedAt: number; result: Promise<VoiceListContextResult> }>();

const cacheKey = (modId: number, srcLang: string, targetLang: string, inherited: boolean): string =>
  `${modId}:${srcLang}:${targetLang}:${inherited ? '1' : '0'}`;

const loadVoiceListContext = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
  opts: { loadInherited: boolean },
): Promise<VoiceListContextResult> => {
  const resolvedTargetLang = targetLang || CONFIG.defaultTgtLang;
  const { rows } = await db.query<{ name: string; abs_path: string | null; game: GameType }>(
    `SELECT name, abs_path, game FROM mods WHERE id = $1`,
    [modId],
  );
  const mod = rows[0];
  if (!mod) {
    return { ok: false, reason: 'mod_not_found', message: 'Mod not found' };
  }
  if (!mod.abs_path) {
    return { ok: false, reason: 'no_plugin_path', message: 'Mod has no plugin path' };
  }

  const pluginPath = resolveModStoredPath(mod.abs_path);
  const ctx = resolveVoicePackageContext(pluginPath, resolvedTargetLang);
  if (!ctx) {
    return { ok: false, reason: 'plugin_missing', message: 'Plugin file not found on disk' };
  }

  const voiceFiles = discoverVoiceEntries(ctx);
  if (voiceFiles.length === 0) {
    return { ok: false, reason: 'no_voice_files', message: 'No voice files found for this mod' };
  }

  const voiceRootRel = resolveVoiceRootRel(ctx.pluginRel);
  const translationAudio = buildTranslationAudioSet(ctx.localizeDir);

  const [sources, translations, masterMods, dbSpeakerNames, speakerRefs, folderGenders] =
    await Promise.all([
      loadVoiceSourcesDetailed(db, modId, srcLang),
      loadVoiceTranslations(db, modId, srcLang, resolvedTargetLang),
      opts.loadInherited
        ? findImportedMasterMods(db, pluginPath, modId, mod.game ?? 'fo4')
        : Promise.resolve([]),
      loadSpeakerNamesFromDb(db, modId),
      loadVoiceSpeakerRefs(db, modId),
      loadVoiceFolderGenders(db, modId),
    ]);

  let inheritedLookup: InheritedVoiceLookup | null = null;
  if (opts.loadInherited && masterMods.length > 0) {
    inheritedLookup = await loadInheritedVoiceLookup(db, masterMods, srcLang, resolvedTargetLang);
    log.debug(
      `Voice list mod=${modId}: inherited lookup from ${masterMods.map((m) => m.pluginName).join(', ')}`,
    );
  }

  return {
    ok: true,
    data: {
      modId,
      ctx,
      voiceRootRel,
      voiceFiles,
      sources,
      translations,
      inheritedLookup,
      dbSpeakerNames,
      speakerRefs,
      folderGenders,
      translationAudio,
    },
  };
};

/** Load shared voice-list inputs, cached briefly so speaker + line requests reuse one scan. */
export const getVoiceListContext = (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
  opts: { loadInherited: boolean },
): Promise<VoiceListContextResult> => {
  const key = cacheKey(modId, srcLang, targetLang, opts.loadInherited);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.loadedAt < CACHE_TTL_MS) return hit.result;

  const result = loadVoiceListContext(db, modId, srcLang, targetLang, opts);
  cache.set(key, { loadedAt: Date.now(), result });
  return result;
};

/** Drop cached voice context after mutations that change audio or references. */
export const invalidateVoiceListContext = (modId: number): void => {
  for (const key of cache.keys()) {
    if (key.startsWith(`${modId}:`)) cache.delete(key);
  }
};
