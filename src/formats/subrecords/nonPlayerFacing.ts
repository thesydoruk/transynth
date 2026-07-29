/**
 * Record types that are not player-facing in standard Bethesda localization workflows.
 *
 * A type belongs here only when xEdit's record definitions mark none of its
 * subrecords `cpTranslate` — that is the test to apply before adding one.
 * ARMA (armor mesh addons) qualifies: it carries meshes and slot indices only.
 *
 * Deliberately absent, because the game shows their text and we import it:
 * - INNR — WNAM fragments the game assembles into item names ("Insulated
 *   Combat Armor"); translated through the dedicated INNR editor.
 * - REFR — map marker labels (XMRK) and renamed object overrides.
 * - KYWD — FULL holds workshop menu categories and armor mod slot names
 *   ("Floors", "Prefabs", "Waist Armor").
 * - LVLI — ONAM overrides unique/legendary item names ("Tessa's Fist").
 *
 * Used at import (subrecord JSON `read: false`) and by the skip-detect scan
 * for rows already in the DB (CSV import, older scans).
 */
export const NON_PLAYER_FACING_RECORDS = ['ARMA'] as const;

export type NonPlayerFacingRecord = (typeof NON_PLAYER_FACING_RECORDS)[number];

export const NON_PLAYER_FACING_RECORD_SET = new Set<string>(NON_PLAYER_FACING_RECORDS);

export const isNonPlayerFacingRecord = (signature: string | null | undefined): boolean =>
  signature != null && NON_PLAYER_FACING_RECORD_SET.has(signature);
