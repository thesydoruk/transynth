/**
 * Voice lines allowed in a langpack / full-mod export.
 *
 * A localized clip is exported only when the FormID maps to a database line
 * that TTS would synthesize — leftovers and skip-filter vocalizations stay out.
 */
import type { Tx } from '../db';
import type { GameType } from '../types';
import { loadDiscoVoiceSources } from './disco/loadDiscoVoiceSources';
import { loadDiscoVoiceTranslations } from './disco/loadDiscoVoiceTranslations';
import { discoVoiceFormidLower6 } from './disco/discoverDiscoVoiceFiles';
import {
  findImportedMasterMods,
  loadInheritedVoiceLookup,
  type InheritedVoiceLookup,
} from './inheritedVoiceText';
import {
  loadVoiceSourcesDetailed,
  loadVoiceTranslations,
  voiceTranslationMapKey,
  type VoiceSourceDetailRow,
  type VoiceTranslationRow,
} from './loadVoiceTranslations';
import { canSynthesizeVoiceLine, type VoiceTtsMarkupStyle } from './prepareVoiceTtsText';

const BETHESDA_VOICE_RE = /^([0-9A-Fa-f]{8})_(\d+)\.(fuz|wav|lip|xwm)$/i;

const markupForGame = (game: GameType): VoiceTtsMarkupStyle =>
  game === 'disco' ? 'disco' : 'fallout';

/** Map a localized clip filename to `FORMID:variant`, or null if it is not a voice take. */
export const voiceKeyFromLocalizedFileName = (
  fileName: string,
  game: GameType = 'fo4',
): string | null => {
  const bethesda = fileName.match(BETHESDA_VOICE_RE);
  if (bethesda) {
    return voiceTranslationMapKey(bethesda[1]!.slice(-6), Number.parseInt(bethesda[2]!, 10));
  }
  if (game === 'disco' && /\.wav$/i.test(fileName)) {
    const stem = fileName.replace(/\.[^.]+$/, '');
    return voiceTranslationMapKey(discoVoiceFormidLower6(stem), 1);
  }
  return null;
};

const addIfExportable = (
  keys: Set<string>,
  key: string,
  source: string | undefined,
  translation: string,
  edid: string | null | undefined,
  markup: VoiceTtsMarkupStyle,
): void => {
  if (canSynthesizeVoiceLine(source, translation, edid, markup)) keys.add(key);
};

const addKeysFromMaps = (
  keys: Set<string>,
  sources: Map<string, VoiceSourceDetailRow>,
  translations: Map<string, VoiceTranslationRow>,
  markup: VoiceTtsMarkupStyle,
): void => {
  for (const key of new Set([...sources.keys(), ...translations.keys()])) {
    const row = translations.get(key);
    addIfExportable(
      keys,
      key,
      sources.get(key)?.source ?? row?.source,
      row?.translation ?? '',
      row?.edid,
      markup,
    );
  }
};

const addInheritedKeys = (
  keys: Set<string>,
  inherited: InheritedVoiceLookup,
  markup: VoiceTtsMarkupStyle,
): void => {
  for (const master of inherited.masters) {
    addKeysFromMaps(
      keys,
      inherited.sourcesByMod.get(master.modId) ?? new Map(),
      inherited.translationsByMod.get(master.modId) ?? new Map(),
      markup,
    );
  }
};

/** Keys (`FORMID6:variant`) whose localized clips may be packed into an export. */
export const loadExportableVoiceKeys = async (
  db: Tx,
  modId: number,
  pluginPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType,
  extractRoot?: string | null,
): Promise<Set<string>> => {
  const keys = new Set<string>();
  const markup = markupForGame(game);

  if (game === 'disco') {
    const [sources, translations] = await Promise.all([
      loadDiscoVoiceSources(db, modId, srcLang, extractRoot),
      loadDiscoVoiceTranslations(db, modId, srcLang, targetLang, extractRoot),
    ]);
    addKeysFromMaps(keys, sources, translations, markup);
    return keys;
  }

  const [sources, translations, masterMods] = await Promise.all([
    loadVoiceSourcesDetailed(db, modId, srcLang),
    loadVoiceTranslations(db, modId, srcLang, targetLang),
    findImportedMasterMods(db, pluginPath, modId),
  ]);
  addKeysFromMaps(keys, sources, translations, markup);
  if (masterMods.length > 0) {
    addInheritedKeys(
      keys,
      await loadInheritedVoiceLookup(db, masterMods, srcLang, targetLang),
      markup,
    );
  }
  return keys;
};
