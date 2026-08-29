/**
 * Computes WCAG relative luminance for an RGB triplet.
 *
 * The output range is from 0 (black) to 1 (white) and is used for
 * contrast-ratio calculations.
 */
export const relativeLuminance = ([r, g, b]: [number, number, number]): number => {
  const toLinear = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };

  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
};
