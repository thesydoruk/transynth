/**
 * Incremental re-scan of already imported plugins.
 *
 * Adds records a previous import never extracted (typically after the
 * translatable-subrecord config changed) without pruning or re-importing rows
 * that already carry translations.
 */
export { backfillModStrings, type BackfillModResult } from './backfillMod';
export { listBackfillTargets, type BackfillTarget, type BackfillSkip } from './targets';
export {
  countRecordsBySignature,
  espRowRecordPath,
  loadExistingRecordKeys,
  selectMissingEspRows,
} from './missingRows';
