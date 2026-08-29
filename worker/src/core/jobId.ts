/**
 * BullMQ rejects custom ids that are digit-only strings (`"123"` →
 * "Custom Id cannot be integers"). Prefix keeps our numeric sequence usable.
 */
export const toBullJobId = (jobId: number): string => `job-${jobId}`;

/** Parse our prefixed BullMQ id (also accepts legacy plain numeric ids). */
export const fromBullJobId = (id: string | undefined | null): number | null => {
  if (id == null || id === '') return null;
  const prefixed = /^job-(\d+)$/.exec(id);
  if (prefixed) return Number(prefixed[1]);
  if (/^\d+$/.test(id)) return Number(id);
  return null;
};
