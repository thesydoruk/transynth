/**
 * Record types that are not player-facing in standard Bethesda localization workflows.
 *
 * Aligned with xEdit's `cpTranslate` definitions: INNR (inheritance markers) and
 * ARMA (armor mesh slots) carry no text the player reads.
 *
 * Deliberately absent, because xEdit marks their text as translatable and the
 * game shows it:
 * - REFR — map marker labels (XMRK) and renamed object overrides.
 * - KYWD — FULL holds workshop menu categories and armor mod slot names
 *   ("Floors", "Prefabs", "Waist Armor").
 * - LVLI — ONAM overrides unique/legendary item names ("Tessa's Fist").
 *
 * Used at import (subrecord JSON `read: false`) and by the skip-detect scan
 * for rows already in the DB (CSV import, older scans).
 */
export const NON_PLAYER_FACING_RECORDS = ['INNR', 'ARMA'] as const;

export type NonPlayerFacingRecord = (typeof NON_PLAYER_FACING_RECORDS)[number];

export const NON_PLAYER_FACING_RECORD_SET = new Set<string>(NON_PLAYER_FACING_RECORDS);

export const isNonPlayerFacingRecord = (signature: string | null | undefined): boolean =>
  signature != null && NON_PLAYER_FACING_RECORD_SET.has(signature);
