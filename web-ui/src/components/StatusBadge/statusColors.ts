/**
 * Status badge palette for chips and progress segments.
 *
 * The map resolves to global CSS custom properties from `index.scss` so theme
 * switching (dark/light) automatically updates colours without touching logic.
 */
export const STATUS_COLORS: Record<string, string> = {
  reviewed: 'var(--status-reviewed)', // green  — confirmed
  human: 'var(--status-human)', // green  — human-confirmed
  draft: 'var(--status-draft)', // lime   — unconfirmed
  rejected: 'var(--status-rejected)', // dark-red
  tm: 'var(--status-tm)', // blue   — translation memory
  fuzzy: 'var(--status-fuzzy)', // cyan   — fuzzy match
  auto: 'var(--status-auto)', // orange — AI/LLM translation
  skip: 'var(--status-skip)', // muted — not translatable
  untranslated: 'var(--status-untranslated)',
};
