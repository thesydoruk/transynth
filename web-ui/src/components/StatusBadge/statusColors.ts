/**
 * Shared translation-status palette.
 *
 * `--status-*` tokens in `index.scss` are the canonical accent colours (badges,
 * menu dots, progress segments). `--status-row-*` tints are derived from the
 * same tokens via `color-mix` so grid rows stay in the same hue family.
 */
export const STATUS_COLORS: Record<string, string> = {
  reviewed: 'var(--status-reviewed)',
  human: 'var(--status-human)',
  draft: 'var(--status-draft)',
  rejected: 'var(--status-rejected)',
  tm: 'var(--status-tm)',
  fuzzy: 'var(--status-fuzzy)',
  auto: 'var(--status-auto)',
  skip: 'var(--status-skip)',
  untranslated: 'var(--status-untranslated)',
};

/** Subtle grid-row backgrounds — mixed from {@link STATUS_COLORS} in CSS. */
export const STATUS_ROW_BG: Record<string, string> = {
  reviewed: 'var(--status-row-reviewed)',
  human: 'var(--status-row-human)',
  draft: 'var(--status-row-draft)',
  rejected: 'var(--status-row-rejected)',
  tm: 'var(--status-row-tm)',
  fuzzy: 'var(--status-row-fuzzy)',
  auto: 'var(--status-row-auto)',
  skip: 'var(--status-row-skip)',
};

/** Accent colour for a status key (badge, context-menu dot, progress bar). */
export const statusAccentColor = (status: string | null | undefined): string =>
  STATUS_COLORS[status ?? 'untranslated'] ?? STATUS_COLORS.untranslated;

/** Row background tint for a status key (editor grid). */
export const statusRowBackground = (status: string | null): string => {
  if (status === '__active') return 'var(--bg-row-hover)';
  if (!status) return 'transparent';
  return STATUS_ROW_BG[status] ?? 'transparent';
};
