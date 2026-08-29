import type { Tx } from '../db';
import {
  findImportedMasterMods,
  loadInheritedVoiceLookup,
  type InheritedVoiceLookup,
} from './inheritedVoiceText';
import { loadVoiceSourcesDetailed, loadVoiceTranslations } from './loadVoiceTranslations';

/** FormID part of a `FORMID6:variant` voice key. */
const keyFormid = (key: string): string => key.split(':')[0] ?? '';

/** FormIDs with NAM1 text, from local rows plus every imported master. */
export const collectVoiceSourceFormids = (
  sources: Map<string, unknown>,
  translations: Map<string, unknown>,
  inherited: InheritedVoiceLookup | null,
): Set<string> => {
  const formids = new Set<string>();
  const add = (keys: Iterable<string>): void => {
    for (const key of keys) formids.add(keyFormid(key));
  };

  add(sources.keys());
  add(translations.keys());
  for (const map of inherited?.sourcesByMod.values() ?? []) add(map.keys());
  for (const map of inherited?.translationsByMod.values() ?? []) add(map.keys());
  return formids;
};

/**
 * Lower-6 FormIDs that have dialogue text for a mod, masters included. Voice
 * audio outside this set has no INFO record anywhere, so it can neither be
 * dubbed nor used as a TTS reference.
 */
export const loadVoiceSourceFormids = async (
  db: Tx,
  modId: number,
  pluginPath: string,
  srcLang: string,
  targetLang: string,
): Promise<Set<string>> => {
  const [sources, translations, masterMods] = await Promise.all([
    loadVoiceSourcesDetailed(db, modId, srcLang),
    loadVoiceTranslations(db, modId, srcLang, targetLang),
    findImportedMasterMods(db, pluginPath, modId),
  ]);
  const inherited =
    masterMods.length > 0
      ? await loadInheritedVoiceLookup(db, masterMods, srcLang, targetLang)
      : null;
  return collectVoiceSourceFormids(sources, translations, inherited);
};
