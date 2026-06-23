/**
 * Returns the CSS background value for a row with the given translation
 * status.
 */
export const rowBg = (status: string | null): string => {
  if (status === '__active') return 'var(--bg-row-hover)';
  if (!status) return 'transparent';
  if (status === 'reviewed') return 'var(--status-row-reviewed)';
  if (status === 'human') return 'var(--status-row-human)';
  if (status === 'draft') return 'var(--status-row-draft)';
  if (status === 'rejected') return 'var(--status-row-rejected)';
  if (status === 'tm') return 'var(--status-row-tm)';
  if (status === 'auto') return 'var(--status-row-auto)';
  if (status === 'fuzzy') return 'var(--status-row-fuzzy)';
  if (status === 'skip') return 'var(--status-row-skip)';
  return 'transparent';
};
