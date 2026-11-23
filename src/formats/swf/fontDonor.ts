/**
 * Pick the donor font that is the same design as a target font.
 *
 * Bethesda builds each locale's font library from the same faces, renamed
 * («NB Grotesk R Semibold» in `fonts_en` is «JP_NB Grotesk Regular» in `fonts_ja`), so
 * names cannot pair them, but their Latin letters can: the same design gives the same
 * advances and ink boxes to within rounding, while a different weight of the same
 * family already moves the boxes by a stem's worth. A font with no counterpart — the
 * extended display face has none — is left without a donor rather than given the
 * nearest stranger.
 */
import { decodeGlyphShape, shapeBounds } from './glyphShape';
import { glyphAdvance, type DefineFont } from './defineFontTag';

/** Units of a `DefineFont3` em square. */
export const EM_UNITS = 20480;

/** Mean difference, as a share of the em, above which two fonts are different designs. */
const MAX_DISTANCE = 0.01;

/** Shared Latin glyphs needed before a comparison means anything. */
const MIN_SHARED = 40;

const LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

type Profile = Map<number, number[]>;

const profileCache = new WeakMap<DefineFont, Profile>();

/** Advance and ink box of every Latin letter and digit, in font units. */
const latinProfile = (font: DefineFont): Profile => {
  const cached = profileCache.get(font);
  if (cached) return cached;
  const profile: Profile = new Map();
  for (const char of LATIN) {
    const codePoint = char.codePointAt(0)!;
    const index = font.codePoints.indexOf(codePoint);
    if (index === -1) continue;
    const box = shapeBounds(decodeGlyphShape(font.shapes[index]!));
    profile.set(codePoint, [
      glyphAdvance(font, index) ?? 0,
      box.xMin,
      box.xMax,
      box.yMin,
      box.yMax,
    ]);
  }
  profileCache.set(font, profile);
  return profile;
};

/**
 * How far apart two fonts' Latin letters are, as a share of the em.
 *
 * @returns Mean absolute difference of advances and ink boxes, or `null` when the
 *   fonts share too few letters to compare.
 */
export const latinDistance = (a: DefineFont, b: DefineFont): number | null => {
  const pa = latinProfile(a);
  const pb = latinProfile(b);
  let sum = 0;
  let count = 0;
  for (const [codePoint, va] of pa) {
    const vb = pb.get(codePoint);
    if (!vb) continue;
    va.forEach((value, i) => (sum += Math.abs(value - vb[i]!)));
    count += va.length;
  }
  return count / 5 < MIN_SHARED ? null : sum / count / EM_UNITS;
};

/**
 * The donor drawing the same design as `target`.
 *
 * @param target - Font that lacks letters.
 * @param donors - Fonts that have them.
 * @returns The closest donor, or `null` when none is close enough to be the same face.
 */
export const matchDonorFont = (target: DefineFont, donors: DefineFont[]): DefineFont | null => {
  let best: { font: DefineFont; distance: number } | null = null;
  for (const donor of donors) {
    const distance = latinDistance(target, donor);
    if (distance === null || distance > MAX_DISTANCE) continue;
    if (!best || distance < best.distance) best = { font: donor, distance };
  }
  return best?.font ?? null;
};
