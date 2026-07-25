/**
 * Picking the strings a bulk QA recomputation should cover.
 *
 * Normal QA runs are triggered by an edit and know exactly which string
 * changed. A newly added rule has no such trigger, so it needs to walk the
 * translations that already exist.
 */
import type { Tx } from '../../../db';
import { DIALOG_PROMPT_PATH, DIALOG_RESPONSE_PATH } from './dialogs';

export type QaRefreshScope = {
  targetLang: string;
  /** Restrict to one mod; omit for every mod. */
  modId?: number;
  /** Only lines that belong to the dialog graph. */
  dialogsOnly?: boolean;
};

export type QaRefreshModCount = {
  mod_id: number;
  mod_name: string;
  strings: number;
};

const DIALOG_JOINS = `
       JOIN dialog_nodes dn ON dn.info_formid_hex = r.formid_hex
       JOIN dialog_topics dt ON dt.id = dn.topic_id AND dt.mod_id = r.mod_id`;

const FROM_SQL = (dialogsOnly: boolean): string => `
       FROM strings s
       JOIN records r ON r.id = s.record_id
       JOIN mods m ON m.id = r.mod_id
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $1
       ${dialogsOnly ? DIALOG_JOINS : ''}
      WHERE ($2::int IS NULL OR r.mod_id = $2)
        AND (NOT $5::boolean OR (r.signature = 'INFO' AND r.path_simplified IN ($3, $4)))`;

const scopeParams = (scope: QaRefreshScope): unknown[] => [
  scope.targetLang,
  scope.modId ?? null,
  DIALOG_RESPONSE_PATH,
  DIALOG_PROMPT_PATH,
  scope.dialogsOnly === true,
];

/** Translated strings in scope, grouped by mod, for a pre-run summary. */
export const countQaRefreshTargets = async (
  db: Tx,
  scope: QaRefreshScope,
): Promise<QaRefreshModCount[]> => {
  const { rows } = await db.query<QaRefreshModCount>(
    `SELECT m.id AS mod_id, m.name AS mod_name, count(DISTINCT s.id)::int AS strings
     ${FROM_SQL(scope.dialogsOnly === true)}
      GROUP BY m.id, m.name
      ORDER BY strings DESC`,
    scopeParams(scope),
  );
  return rows;
};

/** Ids of the translated strings in scope, ordered so chunking stays stable. */
export const listQaRefreshTargetIds = async (db: Tx, scope: QaRefreshScope): Promise<number[]> => {
  const { rows } = await db.query<{ id: number }>(
    `SELECT DISTINCT s.id
     ${FROM_SQL(scope.dialogsOnly === true)}
      ORDER BY s.id`,
    scopeParams(scope),
  );
  return rows.map((row) => row.id);
};
