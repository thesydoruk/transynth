import { describe, it, expect } from '@jest/globals';
import { parseDefineFontTag } from '../defineFontTag';
import { latinDistance, matchDonorFont } from '../fontDonor';
import { fontTag, latinGlyphs, russianGlyphs } from './glyphFixtures';

/** `fontTag` wraps the body in a record header; strip it for the parser. */
const fontOf = (name: string, widen = 1, extra = {}) => {
  const tag = fontTag(1, name, { ...latinGlyphs(widen), ...extra });
  return parseDefineFontTag(tag.subarray(6))!;
};

describe('matchDonorFont', () => {
  const target = fontOf('NB Grotesk R Semibold');
  const same = fontOf('JP_NB Grotesk Regular', 1, russianGlyphs());
  const heavier = fontOf('JP_NB Grotesk Bold', 1.05, russianGlyphs());
  const stranger = fontOf('Display Extended', 4, russianGlyphs());

  it('pairs a font with the donor drawing the same Latin letters', () => {
    expect(latinDistance(target, same)).toBe(0);
    expect(matchDonorFont(target, [stranger, heavier, same])?.name).toBe('JP_NB Grotesk Regular');
  });

  it('prefers the nearer weight when no donor is identical', () => {
    expect(matchDonorFont(target, [stranger, heavier])?.name).toBe('JP_NB Grotesk Bold');
  });

  it('gives a font no donor rather than a different design', () => {
    expect(matchDonorFont(target, [stranger])).toBeNull();
  });

  it('does not compare fonts that share too few letters', () => {
    const digitsOnly = parseDefineFontTag(
      fontTag(2, 'Digits', { 0: latinGlyphs()['0']!, 1: latinGlyphs()['1']! }).subarray(6),
    )!;
    expect(latinDistance(target, digitsOnly)).toBeNull();
  });
});
