/**
 * Extracts the trailing numeric slot suffix from a full EDID string.
 * Returns null when the EDID does not end with a numeric sequence.
 */
export const slotSuffix = (edid: string | null): string | null => {
  if (!edid) return null;
  const match = edid.match(/(\d+)$/);
  return match ? match[1] : null;
};