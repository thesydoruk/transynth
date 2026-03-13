/**
 * Parses `#RGB` / `#RRGGBB` or `rgb()` / `rgba()` strings into RGB channels.
 *
 * Returns `null` when the input format is unsupported or malformed.
 */
export const parseCssColor = (color: string): [number, number, number] | null => {
  const c = color.trim();
  const hex = c.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hex) {
    const raw = hex[1];
    const full = raw.length === 3 ? raw.split('').map((ch) => ch + ch).join('') : raw;
    return [
      Number.parseInt(full.slice(0, 2), 16),
      Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16),
    ];
  }

  const rgb = c.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgb) return null;

  const parts = rgb[1].split(',').map((p) => p.trim());
  if (parts.length < 3) return null;

  const r = Number.parseFloat(parts[0]);
  const g = Number.parseFloat(parts[1]);
  const b = Number.parseFloat(parts[2]);
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;

  return [
    Math.max(0, Math.min(255, r)),
    Math.max(0, Math.min(255, g)),
    Math.max(0, Math.min(255, b)),
  ];
};
