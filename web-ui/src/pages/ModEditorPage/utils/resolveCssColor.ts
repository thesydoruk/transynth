/**
 * Resolves a CSS variable reference like `var(--token)` into a concrete color
 * value using the computed style of the document root.
 *
 * Returns the original input when the value is not a CSS variable, when the
 * token cannot be extracted, or when the code executes outside the browser.
 */
export const resolveCssColor = (color: string): string => {
  const c = color.trim();
  if (!c.startsWith('var(') || typeof window === 'undefined') return c;

  const token = c.match(/^var\((--[^,)\s]+).*/)?.[1];
  if (!token) return c;

  const resolved = window.getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return resolved || c;
};
