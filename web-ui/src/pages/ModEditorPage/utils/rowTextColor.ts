import { parseCssColor } from './parseCssColor';
import { relativeLuminance } from './relativeLuminance';
import { resolveCssColor } from './resolveCssColor';
import { rowBg } from './rowBg';

/**
 * Chooses black or white text for maximal contrast against the row background.
 *
 * For transparent rows or unresolved backgrounds, falls back to the theme
 * token `var(--text)`.
 */
export const rowTextColor = (status: string | null): string => {
  const bg = rowBg(status);
  if (bg === 'transparent') return 'var(--text)';

  const resolved = resolveCssColor(bg);
  const rgb = parseCssColor(resolved);
  if (!rgb) return 'var(--text)';

  const lumBg = relativeLuminance(rgb);
  const contrastWhite = 1.05 / (lumBg + 0.05);
  const contrastBlack = (lumBg + 0.05) / 0.05;
  return contrastWhite >= contrastBlack ? '#fff' : '#000';
};
