/**
 * Voice lines allowed in a langpack / full-mod export.
 *
 * A localized clip is exported only when its FormID maps to a database line
 * that TTS would synthesize — leftovers and skip-filter vocalizations stay out.
 * Which lines a mod has is the game's business; the eligibility rule below is
 * shared, so every game applies the same filter to its own rows.
 */
import type { Tx } from '../db';
import { gamePlugin } from '../games/registry';
import type { GameId } from '../types';
import type { InheritedVoiceLookup } from './inheritedVoiceText';
import type { VoiceSourceDetailRow, VoiceTranslationRow } from './loadVoiceTranslations';
import { canSynthesizeVoiceLine, type VoiceTtsMarkupStyle } from './prepareVoiceTtsText';

/** Add every key whose source/translation pair is worth synthesizing. */
export const addExportableVoiceKeys = (
  keys: Set<string>,
  sources: Map<string, VoiceSourceDetailRow>,
  translations: Map<string, VoiceTranslationRow>,
  markup: VoiceTtsMarkupStyle,
): void => {
  for (const key of new Set([...sources.keys(), ...translations.keys()])) {
    const row = translations.get(key);
    const source = sources.get(key)?.source ?? row?.source;
    if (canSynthesizeVoiceLine(source, row?.translation ?? '', row?.edid, markup)) keys.add(key);
  }
};

/** Same, for lines the mod inherits from an imported master plugin. */
export const addInheritedExportableVoiceKeys = (
  keys: Set<string>,
  inherited: InheritedVoiceLookup,
  markup: VoiceTtsMarkupStyle,
): void => {
  for (const master of inherited.masters) {
    addExportableVoiceKeys(
      keys,
      inherited.sourcesByMod.get(master.modId) ?? new Map(),
      inherited.translationsByMod.get(master.modId) ?? new Map(),
      markup,
    );
  }
};

/** Map a localized clip filename to `FORMID6:variant`, or null if it is not a take. */
export const voiceKeyFromLocalizedFileName = (fileName: string, game: GameId): string | null =>
  gamePlugin(game).voice?.voiceKeyFromFileName(fileName) ?? null;

/** Keys (`FORMID6:variant`) whose localized clips may be packed into an export. */
export const loadExportableVoiceKeys = async (
  db: Tx,
  modId: number,
  pluginPath: string,
  srcLang: string,
  targetLang: string,
  game: GameId,
  extractRoot?: string | null,
): Promise<Set<string>> => {
  const voice = gamePlugin(game).voice;
  if (!voice) return new Set();
  return voice.loadExportableKeys(db, { modId, pluginPath, srcLang, targetLang, extractRoot });
};
