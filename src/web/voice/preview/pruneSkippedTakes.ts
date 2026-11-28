/**
 * Remove the synthesized takes of lines TTS no longer speaks.
 *
 * The skip rules grow — a grunt spelled a new way, a sound label — and every
 * such change leaves behind the takes made before it. Export already keeps them
 * out, but they stay on disk, in the editor's dubbed counts and in the stamps.
 * This walks a mod's voice catalog once and removes the take of every line the
 * rules skip today, by the same removal the editor's Clear uses, so nothing
 * outside the mod's own localize tree can be touched. The translation text stays.
 */
import { CONFIG } from '../../../config';
import type { Tx } from '../../../db';
import type { GameVoiceAdapter } from '../../../games/contract';
import type { VoiceLineCatalog } from '../../../voice/lineCatalog';
import type { VoiceTtsSkipReason } from '../../../voice/prepareVoiceTtsText';
import { buildVoiceLinePreview } from './buildVoiceLinePreview';
import { loadModVoiceMeta } from './previewWav';
import { removeTakeOfVoiceEntry } from './removeVoiceTranslation';
import { getVoiceListContext, invalidateVoiceListContext } from './voiceListContext';

export type PrunedSkippedTakes = {
  /** Lines the rules skip that the catalog shows as dubbed. */
  lines: number;
  byReason: Partial<Record<VoiceTtsSkipReason, number>>;
  /** Take files removed; 0 on a dry run. A dub that sits in another language's tree removes none. */
  takesRemoved: number;
  stampsRemoved: number;
  /** A few of the lines, for the log: `speaker FORMID_n "source" → "translation"`. */
  samples: string[];
};

export type PruneSkippedTakesResult =
  | { ok: false; reason: string; message: string }
  | ({ ok: true } & PrunedSkippedTakes);

const SAMPLE_LIMIT = 8;

/** The same over a catalog already built; `apply` false only counts. */
export const pruneSkippedTakesOfCatalog = async (
  db: Tx,
  catalog: VoiceLineCatalog,
  voice: Pick<GameVoiceAdapter, 'localizedTakeRelPath' | 'takes'>,
  targetLang: string,
  options: { apply?: boolean } = {},
): Promise<PrunedSkippedTakes> => {
  const result: PrunedSkippedTakes = {
    lines: 0,
    byReason: {},
    takesRemoved: 0,
    stampsRemoved: 0,
    samples: [],
  };
  for (const entry of catalog.voiceFiles) {
    if (!catalog.hasLocalizedTake(entry)) continue;
    const speakerKey = catalog.speakerKeyOf(entry);
    const line = buildVoiceLinePreview(catalog, entry, speakerKey);
    if (!line.ttsSkipReason) continue;

    result.lines += 1;
    result.byReason[line.ttsSkipReason] = (result.byReason[line.ttsSkipReason] ?? 0) + 1;
    if (result.samples.length < SAMPLE_LIMIT) {
      result.samples.push(
        `${speakerKey} ${entry.lineKey}_${entry.variant} "${line.source ?? ''}" → "${line.translation ?? ''}"`,
      );
    }
    if (!options.apply) continue;

    const removed = await removeTakeOfVoiceEntry(db, {
      modId: catalog.modId,
      voice,
      ctx: catalog.ctx,
      targetLang,
      entry,
      speakerKey,
      originPlugin: entry.originPlugin,
    });
    result.takesRemoved += removed.takesRemoved;
    result.stampsRemoved += removed.stampsRemoved;
  }
  return result;
};

export const pruneSkippedVoiceTakes = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
  options: { apply?: boolean } = {},
): Promise<PruneSkippedTakesResult> => {
  const lang = targetLang.trim() || CONFIG.defaultTgtLang;
  const meta = await loadModVoiceMeta(db, modId);
  if (!meta.ok) return meta;
  const catalog = await getVoiceListContext(db, modId, srcLang, lang);
  if (!catalog.ok) return catalog;
  try {
    return {
      ok: true,
      ...(await pruneSkippedTakesOfCatalog(db, catalog, meta.voice, lang, options)),
    };
  } finally {
    // The catalog of a base game is large, and after an apply it is stale as well.
    invalidateVoiceListContext(modId);
  }
};
