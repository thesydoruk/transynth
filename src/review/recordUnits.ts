/**
 * Everything that is not a placed dialogue line, grouped so related text is
 * read together: a whole terminal or book, a whole quest, a series of items
 * whose names must follow one pattern, and dialogue the graph could not place.
 */
import type { Tx } from '../db';
import type { LlmPromptFamily } from '../llm/promptFamily';
import { UNREVIEWABLE_STATUSES } from './dialogUnits';
import type { ReviewLine, ReviewUnit } from './types';

export type ModStringRow = {
  id: number;
  signature: string;
  field: string;
  edid: string | null;
  formid_hex: string | null;
  source: string;
  context: string | null;
  translation: string;
  provenance: string | null;
  narrator_gender: string | null;
  narrator_gender_source: string | null;
};

/** Translated, reviewable source strings of one mod, in id order. */
export const loadModStrings = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<ModStringRow[]> => {
  const { rows } = await db.query<ModStringRow>(
    `SELECT s.id, r.signature, split_part(r.path_simplified, '\\', 2) AS field, r.edid, r.formid_hex,
            s.text_raw AS source, s.context, t.text AS translation, t.provenance,
            COALESCE(NULLIF(r.narrator_gender_override, ''), r.narrator_gender) AS narrator_gender,
            r.narrator_gender_source
       FROM records r
       JOIN strings s ON s.record_id = r.id AND s.lang = $2
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $3
      WHERE r.mod_id = $1 AND NOT s.is_ignored AND t.status <> ALL($4::text[])
      ORDER BY s.id`,
    [modId, srcLang, targetLang, [...UNREVIEWABLE_STATUSES]],
  );
  return rows;
};

const recordLine = (row: ModStringRow, contextProvenances?: ReadonlySet<string>): ReviewLine => {
  const out: ReviewLine = {
    id: row.id,
    kind: row.signature === 'INFO' ? (row.field === 'RNAM' ? 'prompt' : 'response') : row.field,
    src: row.source,
    tr: row.translation,
    sig: row.signature,
    field: row.field,
  };
  if (row.context) out.ctx = row.context;
  if (row.edid) out.edid = row.edid;
  if (row.narrator_gender && row.narrator_gender !== 'unknown') {
    const trusted =
      row.narrator_gender_source === 'manual' || row.narrator_gender_source === 'override';
    out.narrator_gender = trusted ? row.narrator_gender : `${row.narrator_gender} (inferred)`;
  }
  if (row.provenance && contextProvenances?.has(row.provenance)) out.context_only = true;
  return out;
};

/** Which rows read as one unit. */
const unitKey = (row: ModStringRow, family: LlmPromptFamily): string => {
  if (family === 'dialog') return `loose:${(row.edid ?? row.formid_hex ?? '').slice(0, 14)}`;
  if (family === 'prose') return `${row.signature}:${row.formid_hex}`;
  if (family === 'quest') {
    return row.signature === 'QUST'
      ? `QUST:${row.edid ?? row.formid_hex}`
      : `${row.signature}:${row.formid_hex}`;
  }
  // A series shares an EDID stem: CombatArmorLeftArm, CombatArmorRightArm…
  const stem = (row.edid ?? '').replace(/[0-9]+$/, '').slice(0, 10);
  return `${row.signature}:${row.field}:${stem}`;
};

/** Units per family for the rows not already placed (dialogue placed by the graph is in `seen`). */
export const collectRecordUnits = (
  rows: readonly ModStringRow[],
  familyOf: (signature: string, field: string) => LlmPromptFamily,
  seen: ReadonlySet<number>,
  contextProvenances?: ReadonlySet<string>,
): Map<LlmPromptFamily, ReviewUnit[]> => {
  const groups = new Map<LlmPromptFamily, Map<string, ModStringRow[]>>();
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    const family = familyOf(row.signature, row.field);
    const byKey = groups.get(family) ?? groups.set(family, new Map()).get(family)!;
    const key = unitKey(row, family);
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(row);
  }

  const out = new Map<LlmPromptFamily, ReviewUnit[]>();
  for (const [family, byKey] of groups) {
    const units = [...byKey.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'en'))
      .map(([key, unitRows]): ReviewUnit => {
        unitRows.sort((a, b) => (a.edid ?? '').localeCompare(b.edid ?? '', 'en') || a.id - b.id);
        const kind =
          family === 'dialog'
            ? 'loose'
            : family === 'prose' || family === 'quest'
              ? 'record'
              : 'group';
        return {
          unit_id: key,
          kind,
          lines: unitRows.map((r) => recordLine(r, contextProvenances)),
        };
      });
    out.set(family, units);
  }
  return out;
};
