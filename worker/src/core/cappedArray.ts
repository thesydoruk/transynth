/**
 * Bound in-process job arrays (rows / issues / candidates).
 *
 * Redis snapshots already slice to {@link CONFIG.jobSnapshotMaxRows}; these
 * helpers stop the worker heap from keeping the uncapped source arrays.
 * Trim is deferred until 2× limit so `splice` stays rare.
 */

/** Drop oldest entries so `arr.length` is at most `limit`. */
export const trimCappedArray = <T>(arr: T[], limit: number): void => {
  if (limit <= 0) {
    arr.length = 0;
    return;
  }
  if (arr.length > limit) arr.splice(0, arr.length - limit);
};

/** Append one item, trimming when the array reaches twice `limit`. */
export const pushCapped = <T>(arr: T[], item: T, limit: number): void => {
  arr.push(item);
  if (limit > 0 && arr.length >= limit * 2) trimCappedArray(arr, limit);
};

/** Append many items, trimming when the array reaches twice `limit`. */
export const pushAllCapped = <T>(arr: T[], items: readonly T[], limit: number): void => {
  if (items.length === 0) return;
  arr.push(...items);
  if (limit > 0 && arr.length >= limit * 2) trimCappedArray(arr, limit);
};
