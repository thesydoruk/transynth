/**
 * Record types that are not player-facing in standard Bethesda localization workflows.
 *
 * Aligned with xTranslator / community practice: KYWD (keywords), INNR
 * (inheritance markers), LVLI (leveled-list overrides), ARMA (armor mesh slots).
 *
 * REFR is deliberately absent: a placed reference carries the map marker label
 * (REFR with an XMRK subrecord) and renamed object overrides, both of which the
 * player reads in game.
 *
 * Used at import (subrecord JSON `read: false`) and by the skip-detect scan
 * for rows already in the DB (CSV import, older scans).
 */
export const NON_PLAYER_FACING_RECORDS = ['KYWD', 'INNR', 'LVLI', 'ARMA'] as const;

export type NonPlayerFacingRecord = (typeof NON_PLAYER_FACING_RECORDS)[number];

export const NON_PLAYER_FACING_RECORD_SET = new Set<string>(NON_PLAYER_FACING_RECORDS);

export const isNonPlayerFacingRecord = (signature: string | null | undefined): boolean =>
  signature != null && NON_PLAYER_FACING_RECORD_SET.has(signature);
