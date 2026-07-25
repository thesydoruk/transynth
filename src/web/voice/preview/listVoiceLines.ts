import fs from 'node:fs';
import type { Tx } from '../../../db';
import type { GameType } from '../../../types';
import { log } from '../../../logger';
import { CONFIG } from '../../../config';
import { resolveVoiceRootRel } from '../../../voice/discoverVoiceFiles';
import {
  loadVoiceSourcesDetailed,
  loadVoiceTranslations,
  lookupVoiceTranslation,
  normalizeVoiceText,
  voiceTranslationMapKey,
} from '../../../voice/loadVoiceTranslations';
import {
  findImportedMasterMods,
  formatInheritedFromLabel,
  loadInheritedVoiceLookup,
  lookupInheritedVoiceLine,
} from '../../../voice/inheritedVoiceText';
import { resolveModStoredPath } from '../../../modStorage';
import { voiceSpeakerKey } from '../../../voice/speakerReference';
import { canSynthesizeVoiceLine } from '../../../voice/prepareVoiceTtsText';
import { resolveLocalizedVoiceAbsPath } from '../../../voice/synthesizeModVoiceLine';
import { loadVoiceSpeakerRefs, voiceSpeakerRefMatches } from '../../../voice/voiceSpeakerRefs';
import { resolveVoicePackageContext } from './context';
import { loadVoiceFolderGenders } from './speakerGender';
import {
  discoverVoiceEntries,
  formatVoiceSpeakerLabel,
  loadSpeakerNamesFromDb,
} from './voiceEntries';
import type { VoiceLinesListResult, VoiceSpeakerGroup } from './types';

/** List all voice lines for a mod, grouped by NPC speaker folder. */
export const listVoiceLinesForMod = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<VoiceLinesListResult> => {
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
  const ctx = resolveVoicePackageContext(pluginPath, targetLang || CONFIG.defaultTgtLang);
  if (!ctx) {
    return { ok: false, reason: 'plugin_missing', message: 'Plugin file not found on disk' };
  }

  const voiceFiles = discoverVoiceEntries(ctx);
  if (voiceFiles.length === 0) {
    return { ok: false, reason: 'no_voice_files', message: 'No voice files found for this mod' };
  }

  const voiceRootRel = resolveVoiceRootRel(ctx.pluginRel);
  const sources = await loadVoiceSourcesDetailed(db, modId, srcLang);
  const translations = await loadVoiceTranslations(
    db,
    modId,
    srcLang,
    targetLang || CONFIG.defaultTgtLang,
  );
  const masterMods = await findImportedMasterMods(db, pluginPath, modId, mod.game ?? 'fo4');
  const inheritedLookup =
    masterMods.length > 0
      ? await loadInheritedVoiceLookup(db, masterMods, srcLang, targetLang || CONFIG.defaultTgtLang)
      : null;
  if (masterMods.length > 0) {
    log.debug(
      `Voice list mod=${modId}: inherited lookup from ${masterMods.map((m) => m.pluginName).join(', ')}`,
    );
  }
  const dbSpeakerNames = await loadSpeakerNamesFromDb(db, modId);
  const speakerRefs = await loadVoiceSpeakerRefs(db, modId);
  const folderGenders = await loadVoiceFolderGenders(db, modId);

  const groups = new Map<string, VoiceSpeakerGroup>();

  for (const entry of voiceFiles) {
    const mapKey = voiceTranslationMapKey(entry.formidLower6, entry.variant);
    const sourceRow = sources.get(mapKey);
    const translationRow = lookupVoiceTranslation(translations, entry.formidLower6, entry.variant);
    const speakerKey = voiceSpeakerKey(entry, voiceRootRel) || 'Unknown';
    const dbSpeaker = dbSpeakerNames.get(entry.formidLower6.toUpperCase());
    const displayName = dbSpeaker || formatVoiceSpeakerLabel(speakerKey);
    const referencePick = speakerRefs[speakerKey] ?? null;
    const hasTranslationAudio = (() => {
      const audioPath = resolveLocalizedVoiceAbsPath(ctx.localizeDir, entry);
      return audioPath != null && fs.existsSync(audioPath);
    })();
    const translationText = normalizeVoiceText(translationRow?.translation) ?? '';
    const localSource =
      normalizeVoiceText(sourceRow?.source) ?? normalizeVoiceText(translationRow?.source);

    let source = localSource;
    let translation = translationText || null;
    let infoFormidHex = sourceRow?.infoFormidHex ?? translationRow?.infoFormidHex ?? null;
    let isInheritedAudio = false;
    let inheritedFrom: string | null = null;

    if (!source && inheritedLookup) {
      const inherited = lookupInheritedVoiceLine(
        inheritedLookup,
        entry.formidLower6,
        entry.variant,
      );
      if (inherited) {
        source = inherited.source;
        translation = translation ?? inherited.translation;
        infoFormidHex = inherited.infoFormidHex || infoFormidHex;
        isInheritedAudio = true;
        inheritedFrom = formatInheritedFromLabel(inherited.master);
      }
    }

    let group = groups.get(speakerKey);
    if (!group) {
      const folderGender = folderGenders.get(speakerKey);
      group = {
        key: speakerKey,
        displayName,
        referencePick,
        gender: folderGender?.gender ?? 'unknown',
        genderMismatch: folderGender?.mismatch ?? false,
        lines: [],
      };
      groups.set(speakerKey, group);
    }

    group.lines.push({
      formidLower6: entry.formidLower6,
      infoFormidHex,
      variant: entry.variant,
      fileName: entry.fileName,
      source,
      translation,
      isReference: referencePick
        ? voiceSpeakerRefMatches(referencePick, entry.formidLower6, entry.variant)
        : false,
      isInheritedAudio,
      inheritedFrom,
      hasTranslationAudio,
      canGenerateVoice:
        canSynthesizeVoiceLine(source, translation ?? '', translationRow?.edid) &&
        !hasTranslationAudio,
    });
  }

  const speakers = [...groups.values()]
    .map((group) => ({
      ...group,
      referencePick: speakerRefs[group.key] ?? null,
      lines: group.lines.sort((a, b) => {
        const formidCmp = a.formidLower6.localeCompare(b.formidLower6);
        return formidCmp !== 0 ? formidCmp : a.variant - b.variant;
      }),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));

  const totalLines = speakers.reduce((sum, group) => sum + group.lines.length, 0);
  log.debug(`Voice list mod=${modId}: ${totalLines} lines in ${speakers.length} speaker groups`);
  return { ok: true, speakers, totalLines };
};
