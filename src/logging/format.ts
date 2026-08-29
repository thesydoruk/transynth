/** Human-readable multi-line log blocks (header + indented fields). */
export const formatLogBlock = (
  header: string,
  fields: Record<string, string | null | undefined>,
): string => {
  const lines = [header];
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === '') continue;
    lines.push(`  ${key}: ${value}`);
  }
  return lines.join('\n');
};

const isSimpleLogValue = (v: unknown): boolean =>
  v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

const formatSimpleLogValue = (v: unknown): string => {
  if (v == null) return '—';
  if (typeof v === 'string') return v.includes(' ') ? JSON.stringify(v) : v;
  return String(v);
};

/** One key=value per line for flat objects; returns null when values are nested. */
export const formatFlatObjectLines = (obj: Record<string, unknown>): string | null => {
  const lines: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (!isSimpleLogValue(val)) return null;
    lines.push(`  ${key}=${formatSimpleLogValue(val)}`);
  }
  return lines.length > 0 ? lines.join('\n') : null;
};
