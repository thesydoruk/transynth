/** A positive integer id from a URL segment, or null — `Number('abc')` would reach SQL as NaN and fail with 500. */
export const parseRouteId = (raw: string): number | null => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};
