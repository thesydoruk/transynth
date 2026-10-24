/**
 * What a mod-wide voice job has to synthesize for one plugin package.
 *
 * A mod's own takes are the obvious part. The other part is what a patch
 * plugin owes the lines it overrides: when `Unofficial Fallout 4 Patch.esp`
 * rewrites a `Fallout4.esm` response and the reviewed translation of that
 * rewrite differs from the base game's, the patch pack has to carry its own
 * dub of that line, at the same `Sound/Voice/Fallout4.esm/…` path the game
 * plays. The reference audio for it is the master's original take, which the
 * patch does not ship. Lines whose translation equals the master's are left to
 * the master's pack — same text, same sound.
 */
import path from 'node:path';
import type { Tx } from '../db';
import { pluginRelPath } from '../modImport/packages';
import {
  dedupeVoiceFiles,
  discoverVoiceFiles,
  resolveVoiceRootRel,
  type VoiceFileEntry,
} from './discoverVoiceFiles';
import {
  findImportedMasterMods,
  loadInheritedVoiceLookup,
  lookupInheritedVoiceLine,
  masterOrigin,
  type InheritedVoiceLookup,
} from './inheritedVoiceText';
import {
  asDubbingEntry,
  loadMasterVoiceContext,
  lookupOriginMasterLine,
  type MasterVoiceContext,
} from './voiceMasterTakes';
import {
  loadVoiceSources,
  loadVoiceTranslations,
  lookupVoiceTranslation,
  normalizeVoiceText,
  voiceTranslationMapKey,
  type VoiceSourceRow,
  type VoiceTranslationRow,
} from './loadVoiceTranslations';
import { groupVoiceFilesBySpeaker, voiceSpeakerKey } from './speakerReference/grouping';
import { fillMissingVoiceKeys } from './voiceTextRows';
import { normalizeVoiceOrigin, splitOriginFormidKey } from './voiceOrigin';

export {
  findMasterBackedTake,
  type MasterBackedTake,
  type MasterVoiceContext,
} from './voiceMasterTakes';

export type VoiceWorkSource = {
  entry: VoiceFileEntry;
  row: VoiceTranslationRow;
  /** Master whose take is the reference audio; null when the take is the mod's own. */
  masterBacked: MasterVoiceContext | null;
  /** Transcript of the reference clip when it is not the line's own source text. */
  referenceSource: string | null;
};

export type VoiceWorkList = {
  ownOrigin: string;
  voiceRootRel: string;
  translations: Map<string, VoiceTranslationRow>;
  /** Source text for reference clips: the mod's own lines plus every lent master's. */
  voiceSources: Map<string, VoiceSourceRow>;
  /** The mod's own takes, deduped. */
  voiceFiles: VoiceFileEntry[];
  items: VoiceWorkSource[];
  /** Per-take and summary messages, already prefixed. */
  skipped: string[];
  masterOfEntry: (entry: VoiceFileEntry) => MasterVoiceContext | null;
  siblingsOf: (speakerKey: string, entry: VoiceFileEntry) => VoiceFileEntry[];
};

const sameVoiceText = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const left = normalizeVoiceText(a);
  const right = normalizeVoiceText(b);
  return left != null && right != null && left === right;
};

const notCurrent =
  (current: VoiceFileEntry) =>
  (candidate: VoiceFileEntry): boolean =>
    candidate.lineKey !== current.lineKey ||
    candidate.variant !== current.variant ||
    candidate.originPlugin !== current.originPlugin;

/**
 * Build the work list for one package: own takes paired with their rows, then
 * the overridden lines of imported masters whose translation this mod changes.
 */
export const loadVoiceWorkList = async (
  db: Tx,
  input: {
    modId: number;
    packageDir: string;
    pluginPath: string;
    srcLang: string;
    tgtLang: string;
    /** Prepended to every reported path (package folder). */
    prefix?: string;
  },
): Promise<VoiceWorkList> => {
  const { modId, packageDir, pluginPath, srcLang, tgtLang } = input;
  const prefix = input.prefix ?? '';
  const pluginRel = pluginRelPath(packageDir, pluginPath);
  const voiceRootRel = resolveVoiceRootRel(pluginRel);
  const ownOrigin = normalizeVoiceOrigin(path.basename(pluginRel));

  const translations = await loadVoiceTranslations(db, modId, srcLang, tgtLang);
  const voiceSources = await loadVoiceSources(db, modId, srcLang);
  const voiceFiles = dedupeVoiceFiles(discoverVoiceFiles(packageDir, pluginRel));

  const skipped: string[] = [];
  const items: VoiceWorkSource[] = [];
  const masterOf = new Map<VoiceFileEntry, MasterVoiceContext>();

  // Lines this plugin carries for another plugin, grouped by that origin.
  const foreignOrigins = new Set<string>();
  for (const row of translations.values()) {
    if (row.originPlugin && row.originPlugin !== ownOrigin) foreignOrigins.add(row.originPlugin);
  }

  let inherited: InheritedVoiceLookup | null = null;
  const contexts = new Map<string, MasterVoiceContext>();
  if (foreignOrigins.size > 0) {
    const masters = await findImportedMasterMods(db, pluginPath, modId);
    inherited = await loadInheritedVoiceLookup(db, masters, srcLang, tgtLang);
    for (const master of masters) {
      const origin = masterOrigin(master);
      if (!foreignOrigins.has(origin)) continue;
      const ctx = loadMasterVoiceContext(master);
      if (ctx) contexts.set(origin, ctx);
      const sources = inherited.sourcesByMod.get(master.modId);
      if (sources) {
        fillMissingVoiceKeys(
          voiceSources,
          new Map([...sources].map(([key, row]) => [key, { source: row.source }])),
        );
      }
    }
  }

  const inheritedLine = (lineKey: string, variant: number, origin: string | undefined) =>
    inherited && origin ? lookupInheritedVoiceLine(inherited, lineKey, variant, origin) : null;

  // 1. The mod's own takes, wherever they sit in its voice tree.
  const ownTakes = new Set<string>();
  let sameAsMasterOwn = 0;
  for (const entry of voiceFiles) {
    const speaker = voiceSpeakerKey(entry, voiceRootRel).toLowerCase();
    ownTakes.add(
      `${voiceTranslationMapKey(entry.lineKey, entry.variant, entry.originPlugin)}|${speaker}`,
    );
    const row = lookupVoiceTranslation(
      translations,
      entry.lineKey,
      entry.variant,
      entry.originPlugin,
    );
    if (!row) {
      skipped.push(`${prefix}${entry.relPath} (no translation for variant ${entry.variant})`);
      continue;
    }
    if (entry.originPlugin && entry.originPlugin !== ownOrigin) {
      const master = inheritedLine(entry.lineKey, entry.variant, entry.originPlugin);
      if (master && sameVoiceText(row.translation, master.translation)) {
        sameAsMasterOwn += 1;
        continue;
      }
    }
    items.push({ entry, row, masterBacked: null, referenceSource: null });
  }

  // 2. Overridden master lines with no own take: borrow the master's.
  let sameAsMaster = 0;
  const missingMaster = new Map<string, number>();
  for (const [key, row] of translations) {
    const origin = row.originPlugin;
    if (!origin || origin === ownOrigin) continue;
    const colon = key.lastIndexOf(':');
    const { lineKey } = splitOriginFormidKey(key.slice(0, colon));
    const variant = Number.parseInt(key.slice(colon + 1), 10);

    const ctx = contexts.get(origin);
    if (!ctx) {
      missingMaster.set(origin, (missingMaster.get(origin) ?? 0) + 1);
      continue;
    }
    const masterTakes = (ctx.byLine.get(key) ?? []).filter(
      (take) => !ownTakes.has(`${key}|${voiceSpeakerKey(take, ctx.voiceRootRel).toLowerCase()}`),
    );
    if (masterTakes.length === 0) {
      if (!ctx.byLine.get(key)?.length) {
        skipped.push(`${prefix}${origin}/${lineKey}_${variant} (master take not found)`);
      }
      continue;
    }
    // "Same as master" asks what the player would see without this mod: the most
    // specific master's translation. The transcript is the origin master's own line.
    const master = inheritedLine(lineKey, variant, origin);
    if (master && sameVoiceText(row.translation, master.translation)) {
      sameAsMaster += masterTakes.length;
      continue;
    }
    const reference = inherited
      ? lookupOriginMasterLine(inherited, lineKey, variant, origin)
      : null;
    for (const take of masterTakes) {
      const entry = asDubbingEntry(take, ctx, voiceRootRel);
      masterOf.set(entry, ctx);
      items.push({
        entry,
        row,
        masterBacked: ctx,
        referenceSource: reference?.source ?? null,
      });
    }
  }

  if (sameAsMasterOwn + sameAsMaster > 0) {
    skipped.push(
      `${prefix}${sameAsMasterOwn + sameAsMaster} takes skipped: same as master (translation unchanged)`,
    );
  }
  for (const [origin, count] of missingMaster) {
    skipped.push(
      `${prefix}${count} lines skipped: master ${origin} is not imported or has no takes`,
    );
  }

  // A speaker's clips across the mod and every lent master: a reference picked in the
  // editor may be a master's take, and every take of that voice must be able to find it.
  let ownBySpeaker: Map<string, VoiceFileEntry[]> | undefined;
  const allBySpeaker = new Map<string, VoiceFileEntry[]>();
  const siblingsOf = (speakerKey: string, entry: VoiceFileEntry): VoiceFileEntry[] => {
    let pool = allBySpeaker.get(speakerKey);
    if (!pool) {
      ownBySpeaker ??= groupVoiceFilesBySpeaker(voiceFiles, voiceRootRel);
      pool = [
        ...(ownBySpeaker.get(speakerKey) ?? []),
        ...[...contexts.values()].flatMap((ctx) => ctx.bySpeaker.get(speakerKey) ?? []),
      ];
      allBySpeaker.set(speakerKey, pool);
    }
    return pool.filter(notCurrent(entry));
  };

  return {
    ownOrigin,
    voiceRootRel,
    translations,
    voiceSources,
    voiceFiles,
    items,
    skipped,
    masterOfEntry: (entry) => masterOf.get(entry) ?? null,
    siblingsOf,
  };
};
