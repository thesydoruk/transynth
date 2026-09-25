/**
 * Repair a proven gender leak before the auditor sees the line.
 *
 * Verify used to audit first and repair afterwards, in the persist step, and
 * the repaired wording was never audited: it went into the database as `auto`
 * and waited for the next run to be judged, so a leaking line needed two
 * verify runs to reach `reviewed`, and in the meantime an audit call had been
 * spent on text the detector already knew was wrong.
 *
 * Here the detector runs first. A line it can prove wrong — see
 * {@link isGenderLeakProvenForRow} — goes to the specialist pass as it stands,
 * and the repaired wording replaces the original in the chunk, so the audit
 * that follows judges the text that will actually be approved. A line the pass
 * could not fix is audited as it is, blocks as before, and is remembered so the
 * persist step does not hand it to the same pass a second time in the same run.
 */
import { findGenderLeaks, isGenderGuardLanguage } from '../../../../../src/llm/genderGuard';
import type { LlmVerifyItem } from '../../../../../src/llm/verifyTranslate';
import { parseRecordLocation } from '../../../../../src/utils/recordLocation';
import { repairProvenGenderLeaks, type EditVerifyFixesOpts } from './editVerifyFixes';
import { isGenderLeakProvenForRow } from './provenGender';
import type { VerifyStringRow } from './types';

/** One wording the pass replaced, ready to be written before the audit. */
export type GenderPreRepair = {
  stringId: number;
  text: string;
  /** The row as it was, for the action log. */
  row: VerifyStringRow;
};

export type PreRepairGenderLeaksOutcome = {
  /** The chunk with repaired wordings in place of the leaking ones. */
  rows: VerifyStringRow[];
  repaired: GenderPreRepair[];
  /** Every row that was sent to the pass, fixed or not. */
  attempted: Set<number>;
};

export type PreRepairGenderLeaksDeps = {
  repair: typeof repairProvenGenderLeaks;
};

const defaultDeps: PreRepairGenderLeaksDeps = { repair: repairProvenGenderLeaks };

/**
 * @param rows - The chunk about to be audited.
 * @param items - The same rows as the auditor will see them, whose participant
 * fields the detector reads.
 */
export const preRepairGenderLeaks = async (
  rows: VerifyStringRow[],
  items: readonly LlmVerifyItem[],
  opts: EditVerifyFixesOpts,
  deps: PreRepairGenderLeaksDeps = defaultDeps,
): Promise<PreRepairGenderLeaksOutcome> => {
  const unchanged = { rows, repaired: [], attempted: new Set<number>() };
  if (rows.length === 0 || !isGenderGuardLanguage(opts.targetLang)) return unchanged;

  const itemById = new Map(items.map((item) => [item.id, item]));
  const leaking = rows.filter((row) => {
    const item = itemById.get(row.string_id);
    if (!item) return false;
    const { grup } = parseRecordLocation(row.signature, row.path);
    if (!isGenderLeakProvenForRow(row, grup, opts.game)) return false;
    return findGenderLeaks(item.translation, item, opts.targetLang).length > 0;
  });
  if (leaking.length === 0) return unchanged;

  const attempted = new Set(leaking.map((row) => row.string_id));
  const fixed = await deps.repair(leaking, opts);
  if (fixed.size === 0) return { rows, repaired: [], attempted };

  const repaired: GenderPreRepair[] = [];
  const next = rows.map((row) => {
    const text = fixed.get(row.string_id);
    if (text == null) return row;
    repaired.push({ stringId: row.string_id, text, row });
    // The row now carries the wording it is about to be judged on, and
    // remembers the one it just left, so a later fix cannot walk it back.
    return {
      ...row,
      translation: text,
      rewrite_count: row.rewrite_count + 1,
      prior_texts: [...row.prior_texts, row.translation],
    };
  });

  return { rows: next, repaired, attempted };
};

/**
 * Keep only the repairs that reached the database.
 *
 * A repaired wording that was not written must not be audited either: the
 * approval that followed would land on the leaking text still stored.
 */
export const keepPersistedPreRepairs = (
  outcome: PreRepairGenderLeaksOutcome,
  persisted: ReadonlySet<number>,
): PreRepairGenderLeaksOutcome => {
  if (persisted.size === outcome.repaired.length) return outcome;
  const originalById = new Map(outcome.repaired.map((fix) => [fix.stringId, fix.row]));
  return {
    rows: outcome.rows.map((row) =>
      persisted.has(row.string_id) ? row : (originalById.get(row.string_id) ?? row),
    ),
    repaired: outcome.repaired.filter((fix) => persisted.has(fix.stringId)),
    attempted: outcome.attempted,
  };
};
