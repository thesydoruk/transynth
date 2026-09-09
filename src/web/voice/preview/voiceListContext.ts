import type { Tx } from '../../../db';
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
import { collectVoiceSourceFormids } from '../../../voice/voiceSourceFormids';
import { resolveModStoredPath } from '../../../modStorage';
import { loadVoiceSpeakerRefs, type VoiceSpeakerRefMap } from '../../../voice/voiceSpeakerRefs';
import {
  discoVoiceFileEntryFromClip,
  resolveDiscoPreferredLangFolder,
  resolveDiscoVoiceExtractRoot,
} from '../../../voice/disco/discoverDiscoVoiceFiles';
import { loadDiscoVoiceClipSummaries } from '../../../voice/disco/loadVoiceClips';
import { ensureDiscoVoiceClips } from '../../../voice/disco/persistVoiceClips';
import { resolveVoicePackageContext, type VoicePackageContext } from './context';
import { loadVoiceFolderGenders, type VoiceFolderGender } from './speakerGender';
import { discoverVoiceEntries, loadSpeakerNamesFromDb } from './voiceEntries';
import { loadDiscoSpeakerGenders, loadDiscoSpeakerNames } from './discoVoiceList';
import { buildTranslationAudioSet } from './translationAudioIndex';
import {
  loadVoiceSimilarityMap,
  type VoiceSimilarityMap,
} from '../../../voice/voiceSynthesisState';

export type VoiceListContextError = {
  ok: false;
  reason: 'mod_not_found' | 'no_plugin_path' | 'plugin_missing' | 'no_voice_files';
  message: string;
};

export type VoiceListContext = {
  modId: number;
  isDisco: boolean;
  ctx: VoicePackageContext;
  voiceRootRel: string;
  voiceFiles: VoiceFileEntry[];
  sources: Awaited<ReturnType<typeof loadVoiceSourcesDetailed>>;
  translations: Map<string, VoiceTranslationRow>;
  inheritedLookup: InheritedVoiceLookup | null;
  /**
   * FormIDs that have source text — audio missing here is orphan (no line to dub).
   */
  sourceFormids: Set<string>;
  dbSpeakerNames: Map<string, string>;
  speakerRefs: VoiceSpeakerRefMap;
  folderGenders: Map<string, VoiceFolderGender>;
  translationAudio: Set<string>;
  voiceSimilarities: VoiceSimilarityMap;
};

export type VoiceListContextResult = VoiceListContextError | { ok: true; data: VoiceListContext };

type VoiceListCacheEntry = {
  revision: string;
  result: Promise<VoiceListContextResult>;
};

const cache = new Map<string, VoiceListCacheEntry>();

const cacheKey = (modId: number, srcLang: string, targetLang: string): string =>
  `${modId}:${srcLang}:${targetLang}`;

/**
 * Cheap fingerprint of data the voice list must not serve stale.
 *
 * The worker writes `voice_synthesis_state` in another process, so a wall-clock
 * TTL cannot see new takes. Speaker refs change on the web process.
 */
export const loadVoiceListRevision = async (
  db: Tx,
  modId: number,
  targetLang: string,
): Promise<string> => {
  const { rows } = await db.query<{
    synth_n: string;
    synth_at: Date | string | null;
    ref_n: string;
    ref_at: Date | string | null;
  }>(
    `SELECT
       (SELECT COUNT(*)::text
          FROM voice_synthesis_state
         WHERE mod_id = $1 AND target_lang = $2) AS synth_n,
       (SELECT MAX(synthesized_at)
          FROM voice_synthesis_state
         WHERE mod_id = $1 AND target_lang = $2) AS synth_at,
       (SELECT COUNT(*)::text
          FROM voice_speaker_refs
         WHERE mod_id = $1) AS ref_n,
       (SELECT MAX(updated_at)
          FROM voice_speaker_refs
         WHERE mod_id = $1) AS ref_at`,
    [modId, targetLang],
  );
  const row = rows[0];
  const stamp = (value: Date | string | null | undefined): string => {
    if (value == null) return 'none';
    return value instanceof Date ? value.toISOString() : String(value);
  };
  return `${row?.synth_n ?? '0'}:${stamp(row?.synth_at)}:${row?.ref_n ?? '0'}:${stamp(row?.ref_at)}`;
};

const loadVoiceListContext = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<VoiceListContextResult> => {
  const resolvedTargetLang = targetLang || CONFIG.defaultTgtLang;
  const { rows } = await db.query<{ name: string; abs_path: string | null; game: string | null }>(
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

  const isDisco = (mod.game ?? '').toLowerCase() === 'disco';
  const pluginPath = resolveModStoredPath(mod.abs_path);
  const ctx = resolveVoicePackageContext(pluginPath, resolvedTargetLang);
  if (!ctx) {
    return { ok: false, reason: 'plugin_missing', message: 'Plugin file not found on disk' };
  }

  if (isDisco) {
    const extractRoot = resolveDiscoVoiceExtractRoot(pluginPath);
    if (!extractRoot) {
      return { ok: false, reason: 'no_voice_files', message: 'No voice files found for this mod' };
    }
    await ensureDiscoVoiceClips(db, modId, extractRoot);
    const langFolder = resolveDiscoPreferredLangFolder(extractRoot);
    const clips = await loadDiscoVoiceClipSummaries(db, modId);
    if (!langFolder || clips.length === 0) {
      return { ok: false, reason: 'no_voice_files', message: 'No voice files found for this mod' };
    }

    const voiceFiles = clips.map((clip) => discoVoiceFileEntryFromClip(langFolder, clip));
    const sourceFormids = new Set(
      clips.filter((clip) => clip.recordId != null).map((clip) => clip.formidLower12),
    );
    const translationAudio = buildTranslationAudioSet(ctx.localizeDir, { disco: true });
    const [dbSpeakerNames, speakerRefs, folderGenders, voiceSimilarities] = await Promise.all([
      loadDiscoSpeakerNames(db, modId),
      loadVoiceSpeakerRefs(db, modId),
      loadDiscoSpeakerGenders(db, modId),
      loadVoiceSimilarityMap(db, modId, resolvedTargetLang),
    ]);

    return {
      ok: true,
      data: {
        modId,
        isDisco: true,
        ctx,
        voiceRootRel: 'Audio',
        voiceFiles,
        sources: new Map(),
        translations: new Map(),
        inheritedLookup: null,
        sourceFormids,
        dbSpeakerNames,
        speakerRefs,
        folderGenders,
        translationAudio,
        voiceSimilarities,
      },
    };
  }

  const voiceFiles = discoverVoiceEntries(ctx);
  if (voiceFiles.length === 0) {
    return { ok: false, reason: 'no_voice_files', message: 'No voice files found for this mod' };
  }

  const voiceRootRel = resolveVoiceRootRel(ctx.pluginRel);
  const translationAudio = buildTranslationAudioSet(ctx.localizeDir);

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
    loadVoiceTranslations(db, modId, srcLang, resolvedTargetLang),
    findImportedMasterMods(db, pluginPath, modId),
    loadSpeakerNamesFromDb(db, modId),
    loadVoiceSpeakerRefs(db, modId),
    loadVoiceFolderGenders(db, modId),
    loadVoiceSimilarityMap(db, modId, resolvedTargetLang),
  ]);

  let inheritedLookup: InheritedVoiceLookup | null = null;
  if (masterMods.length > 0) {
    inheritedLookup = await loadInheritedVoiceLookup(db, masterMods, srcLang, resolvedTargetLang);
    log.debug(
      `Voice list mod=${modId}: inherited lookup from ${masterMods.map((m) => m.pluginName).join(', ')}`,
    );
  }

  return {
    ok: true,
    data: {
      modId,
      isDisco: false,
      ctx,
      voiceRootRel,
      voiceFiles,
      sources,
      translations,
      inheritedLookup,
      sourceFormids: collectVoiceSourceFormids(sources, translations, inheritedLookup),
      dbSpeakerNames,
      speakerRefs,
      folderGenders,
      translationAudio,
      voiceSimilarities,
    },
  };
};

/**
 * Load shared voice-list inputs. Speaker + line requests reuse one catalog scan
 * while the synthesis/ref revision is unchanged. A finished voice job bumps
 * stamps, so the next GET rebuilds and sees new audio immediately.
 */
export const getVoiceListContext = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<VoiceListContextResult> => {
  const resolvedTargetLang = targetLang || CONFIG.defaultTgtLang;
  const revision = await loadVoiceListRevision(db, modId, resolvedTargetLang);
  const key = cacheKey(modId, srcLang, resolvedTargetLang);
  const hit = cache.get(key);
  if (hit && hit.revision === revision) return hit.result;

  const result = loadVoiceListContext(db, modId, srcLang, targetLang).then((loaded) => {
    if (!loaded.ok) {
      const current = cache.get(key);
      if (current?.revision === revision) cache.delete(key);
    }
    return loaded;
  });
  cache.set(key, { revision, result });
  return result;
};

/** Drop cached voice context after mutations that change audio or references. */
export const invalidateVoiceListContext = (modId: number): void => {
  for (const key of cache.keys()) {
    if (key.startsWith(`${modId}:`)) cache.delete(key);
  }
};
