/**
 * Every reviewable line of one mod, cut into batches: dialogue as whole
 * conversations, other text by family (prose, quest, item, …) as the game's
 * prompt families define them, each batch carrying the canonical names it
 * mentions and the QA hints its lines already have.
 */
import type { Tx } from '../db';
import { findGamePlugin } from '../games/registry';
import type { LlmPromptFamily } from '../llm/promptFamily';
import { collectDialogUnits, type DialogUnitOptions } from './dialogUnits';
import { createNameMatcher } from './names';
import { packUnits } from './pack';
import { collectRecordUnits, loadModStrings } from './recordUnits';
import type { ReviewBatch, ReviewUnit } from './types';

/** Families in the order batches are numbered and read. */
const FAMILY_ORDER: readonly LlmPromptFamily[] = [
  'dialog',
  'prose',
  'quest',
  'item',
  'mcm',
  'face',
  'default',
];

/** QA findings worth an editor's look; the rest are mechanical. */
const HINT_ISSUE_TYPES = [
  'llm_review',
  'gender_mismatch',
  'calque',
  'glossary_violation',
  'same_as_source',
  'tone_tag',
];
const HINTS_PER_LINE = 3;

export type BuildBatchesOptions = Pick<
  DialogUnitOptions,
  'srcLang' | 'targetLang' | 'contextProvenances' | 'onProgress'
> & {
  modId: number;
  /** Batch id prefix; defaults to a slug of the mod name. */
  prefix?: string;
};

export type ModBatches = {
  mod: { id: number; name: string; game: string };
  batches: ReviewBatch[];
};

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 12) || 'mod';

const loadQaHints = async (
  db: Tx,
  modId: number,
  targetLang: string,
): Promise<Map<number, string[]>> => {
  const { rows } = await db.query<{ id: number; issue_type: string; message: string }>(
    `SELECT qi.src_string_id AS id, qi.issue_type, qi.message
       FROM qa_issues qi
       JOIN strings s ON s.id = qi.src_string_id
       JOIN records r ON r.id = s.record_id
      WHERE r.mod_id = $1 AND qi.target_lang = $2 AND qi.is_active AND qi.issue_type = ANY($3::text[])
      ORDER BY qi.id`,
    [modId, targetLang, HINT_ISSUE_TYPES],
  );
  const hints = new Map<number, string[]>();
  for (const row of rows) {
    const list = hints.get(row.id) ?? hints.set(row.id, []).get(row.id)!;
    if (list.length < HINTS_PER_LINE) list.push(`${row.issue_type}: ${row.message}`);
  }
  return hints;
};

const withHints = (units: ReviewUnit[], hints: Map<number, string[]>): ReviewUnit[] =>
  units.map((u) => ({
    ...u,
    lines: u.lines.map((l) =>
      hints.has(l.id) && !l.context_only ? { ...l, qa_hints: hints.get(l.id) } : l,
    ),
  }));

export const buildModBatches = async (db: Tx, opts: BuildBatchesOptions): Promise<ModBatches> => {
  const { rows: modRows } = await db.query<{ id: number; name: string; game: string }>(
    `SELECT id, name, game FROM mods WHERE id = $1`,
    [opts.modId],
  );
  const mod = modRows[0];
  if (!mod) throw new Error(`No mod ${opts.modId}`);
  const plugin = findGamePlugin(mod.game);
  const familyOf = (signature: string, field: string): LlmPromptFamily =>
    plugin?.prompts.resolveFamily?.(signature, field) ??
    (plugin?.dialog?.isSpokenSignature(signature) ? 'dialog' : 'default');

  const seen = new Set<number>();
  const dialogUnits = plugin?.dialog ? await collectDialogUnits(db, mod.id, seen, opts) : [];
  const rows = await loadModStrings(db, mod.id, opts.srcLang, opts.targetLang);
  const recordUnits = collectRecordUnits(rows, familyOf, seen, opts.contextProvenances);
  const hints = await loadQaHints(db, mod.id, opts.targetLang);
  const names = createNameMatcher(
    opts.srcLang === 'en' && opts.targetLang === 'uk' ? plugin?.prompts.nameCanon : undefined,
  );

  const prefix = opts.prefix ?? slug(mod.name);
  const batches: ReviewBatch[] = [];
  for (const family of FAMILY_ORDER) {
    const units = [...(family === 'dialog' ? dialogUnits : []), ...(recordUnits.get(family) ?? [])];
    for (const [i, batchUnits] of packUnits(withHints(units, hints), family).entries()) {
      batches.push({
        batch_id: `${prefix}-${family}-${String(i + 1).padStart(3, '0')}`,
        mod: mod.name,
        mod_id: mod.id,
        game: mod.game,
        family,
        names: names(batchUnits),
        units: batchUnits,
      });
    }
  }
  return { mod, batches };
};
