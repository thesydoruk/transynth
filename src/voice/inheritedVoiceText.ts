import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../db';
import { readPluginMasterNames } from '../formats/esp';
import {
  loadVoiceSourcesDetailed,
  loadVoiceTranslations,
  normalizeVoiceText,
  voiceTranslationMapKey,
  type VoiceSourceDetailRow,
  type VoiceTranslationRow,
} from './loadVoiceTranslations';
import { normalizeVoiceOrigin } from './voiceOrigin';

export type MasterModRef = {
  modId: number;
  modName: string;
  /** Master file name as the TES4 header spells it. */
  pluginName: string;
  /** `mods.abs_path` of the imported master, as stored. */
  absPath: string;
};

export type InheritedVoiceLine = {
  source: string;
  translation: string | null;
  infoFormidHex: string;
  stringId: number;
  translationId: number | null;
  status: string | null;
  master: MasterModRef;
};

export type InheritedVoiceLookup = {
  masters: MasterModRef[];
  sourcesByMod: Map<number, Map<string, VoiceSourceDetailRow>>;
  translationsByMod: Map<number, Map<string, VoiceTranslationRow>>;
};

/** Master plugins from the TES4 header, most specific dependency first. */
const readMasterPluginNames = (pluginPath: string): string[] => {
  if (!fs.existsSync(pluginPath)) return [];
  try {
    return readPluginMasterNames(pluginPath).reverse();
  } catch {
    return [];
  }
};

/** Origin a master's own lines carry: its file name, lower-cased. */
export const masterOrigin = (master: MasterModRef): string =>
  normalizeVoiceOrigin(master.pluginName);

/**
 * Match imported mods by plugin basename (e.g. `AA FusionCityRising.esp`).
 *
 * Most specific master first; masters that were never imported are left out,
 * so callers must find a master by name, never by position.
 */
export const findImportedMasterMods = async (
  db: Tx,
  pluginPath: string,
  excludeModId: number,
): Promise<MasterModRef[]> => {
  const masterNames = readMasterPluginNames(pluginPath);
  if (masterNames.length === 0) return [];

  const { rows } = await db.query<{ id: number; name: string; abs_path: string }>(
    `SELECT id, name, abs_path
     FROM mods
     WHERE abs_path IS NOT NULL
       AND id <> $1
     ORDER BY id`,
    [excludeModId],
  );

  const byBasename = new Map<string, { id: number; name: string; absPath: string }>();
  for (const row of rows) {
    const base = path.basename(row.abs_path).toLowerCase();
    if (!byBasename.has(base)) {
      byBasename.set(base, { id: row.id, name: row.name, absPath: row.abs_path });
    }
  }

  const refs: MasterModRef[] = [];
  for (const pluginName of masterNames) {
    const hit = byBasename.get(pluginName.toLowerCase());
    if (hit) {
      refs.push({ modId: hit.id, modName: hit.name, pluginName, absPath: hit.absPath });
    }
  }
  return refs;
};

/** The imported master that owns lines of this origin, if any. */
export const findMasterByOrigin = (
  masters: MasterModRef[],
  origin: string | null | undefined,
): MasterModRef | null => {
  const wanted = normalizeVoiceOrigin(origin);
  if (!wanted) return null;
  return masters.find((master) => masterOrigin(master) === wanted) ?? null;
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

/**
 * Resolve voice line text from master plugins when the current mod has no local NAM1.
 *
 * With an `origin` the line is looked up under that origin in every master, most
 * specific first — a DLC that overrides a `Fallout4.esm` line wins over the
 * base game. Without one, each master is asked for its own lines only.
 */
export const lookupInheritedVoiceLine = (
  lookup: InheritedVoiceLookup,
  lineKey: string,
  variant: number,
  origin?: string | null,
): InheritedVoiceLine | null => {
  const wanted = normalizeVoiceOrigin(origin);
  for (const master of lookup.masters) {
    const sources = lookup.sourcesByMod.get(master.modId);
    const translations = lookup.translationsByMod.get(master.modId);
    const mapKey = voiceTranslationMapKey(lineKey, variant, wanted || masterOrigin(master));
    const sourceRow = sources?.get(mapKey);
    const translationRow = translations?.get(mapKey);
    const source =
      normalizeVoiceText(sourceRow?.source) ?? normalizeVoiceText(translationRow?.source);
    if (!source) continue;

    return {
      source,
      translation: normalizeVoiceText(translationRow?.translation),
      infoFormidHex: sourceRow?.infoFormidHex ?? translationRow?.infoFormidHex ?? '',
      stringId: sourceRow?.stringId ?? translationRow?.stringId ?? 0,
      translationId: translationRow?.translationId ?? null,
      status: translationRow?.status ?? null,
      master,
    };
  }
  return null;
};

export const formatInheritedFromLabel = (master: MasterModRef): string =>
  `${master.modName} (${master.pluginName})`;
