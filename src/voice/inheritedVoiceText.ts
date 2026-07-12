import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../db';
import { EspReader } from '../formats/esp';
import type { GameType } from '../types';
import {
  loadVoiceSourcesDetailed,
  loadVoiceTranslations,
  lookupVoiceTranslation,
  normalizeVoiceText,
  voiceTranslationMapKey,
  type VoiceSourceDetailRow,
  type VoiceTranslationRow,
} from './loadVoiceTranslations';

export type MasterModRef = {
  modId: number;
  modName: string;
  pluginName: string;
};

export type InheritedVoiceLine = {
  source: string;
  translation: string | null;
  infoFormidHex: string;
  master: MasterModRef;
};

export type InheritedVoiceLookup = {
  masters: MasterModRef[];
  sourcesByMod: Map<number, Map<string, VoiceSourceDetailRow>>;
  translationsByMod: Map<number, Map<string, VoiceTranslationRow>>;
};

/** Master plugins from the TES4 header, most specific dependency first. */
export const readMasterPluginNames = (pluginPath: string, game: GameType = 'fo4'): string[] => {
  if (!fs.existsSync(pluginPath)) return [];
  const esp = new EspReader(pluginPath, game);
  return [...esp.info.masterFiles].reverse();
};

/** Match imported mods by plugin basename (e.g. `AA FusionCityRising.esp`). */
export const findImportedMasterMods = async (
  db: Tx,
  pluginPath: string,
  excludeModId: number,
  game: GameType = 'fo4',
): Promise<MasterModRef[]> => {
  const masterNames = readMasterPluginNames(pluginPath, game);
  if (masterNames.length === 0) return [];

  const { rows } = await db.query<{ id: number; name: string; abs_path: string }>(
    `SELECT id, name, abs_path
     FROM mods
     WHERE abs_path IS NOT NULL
       AND id <> $1`,
    [excludeModId],
  );

  const byBasename = new Map<string, { id: number; name: string }>();
  for (const row of rows) {
    const base = path.basename(row.abs_path).toLowerCase();
    if (!byBasename.has(base)) {
      byBasename.set(base, { id: row.id, name: row.name });
    }
  }

  const refs: MasterModRef[] = [];
  for (const pluginName of masterNames) {
    const hit = byBasename.get(pluginName.toLowerCase());
    if (hit) {
      refs.push({ modId: hit.id, modName: hit.name, pluginName });
    }
  }
  return refs;
};

export const loadInheritedVoiceLookup = async (
  db: Tx,
  masters: MasterModRef[],
  srcLang: string,
  tgtLang: string,
): Promise<InheritedVoiceLookup> => {
  const sourcesByMod = new Map<number, Map<string, VoiceSourceDetailRow>>();
  const translationsByMod = new Map<number, Map<string, VoiceTranslationRow>>();

  for (const master of masters) {
    sourcesByMod.set(master.modId, await loadVoiceSourcesDetailed(db, master.modId, srcLang));
    translationsByMod.set(
      master.modId,
      await loadVoiceTranslations(db, master.modId, srcLang, tgtLang),
    );
  }

  return { masters, sourcesByMod, translationsByMod };
};

/** Resolve voice line text from master plugins when the current mod has no local NAM1. */
export const lookupInheritedVoiceLine = (
  lookup: InheritedVoiceLookup,
  formidLower6: string,
  variant: number,
): InheritedVoiceLine | null => {
  for (const master of lookup.masters) {
    const sources = lookup.sourcesByMod.get(master.modId);
    const translations = lookup.translationsByMod.get(master.modId);
    const mapKey = voiceTranslationMapKey(formidLower6, variant);
    const sourceRow = sources?.get(mapKey);
    const translationRow = lookupVoiceTranslation(translations ?? new Map(), formidLower6, variant);
    const source =
      normalizeVoiceText(sourceRow?.source) ?? normalizeVoiceText(translationRow?.source);
    if (!source) continue;

    return {
      source,
      translation: normalizeVoiceText(translationRow?.translation),
      infoFormidHex: sourceRow?.infoFormidHex ?? translationRow?.infoFormidHex ?? '',
      master,
    };
  }
  return null;
};

export const formatInheritedFromLabel = (master: MasterModRef): string =>
  `${master.modName} (${master.pluginName})`;
