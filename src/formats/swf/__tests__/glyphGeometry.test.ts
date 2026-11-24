import { describe, it, expect } from '@jest/globals';
import { addJoinedUpturn, repeatGlyph, stretchGlyphX } from '../glyphCompose';
import { outlineBounds, outlineCrossings, outlineToShape, shapeToOutline } from '../glyphContours';
import { emboldenOutline } from '../glyphEmbolden';
import { fitFactors, fitOutline, stemMetrics } from '../glyphFit';
import { decodeGlyphShape, shapeBounds, type GlyphShape, type ShapeRecord } from '../glyphShape';
import { box, ghe } from './glyphFixtures';

const shapeOf = (bytes: Buffer): GlyphShape => decodeGlyphShape(bytes);
const outlineOf = (bytes: Buffer) => shapeToOutline(shapeOf(bytes))!;

/** A square ring: outer 0..100, counter 30..70, the counter wound the same way. */
const ring = (): GlyphShape => {
  const square = (x: number, size: number): ShapeRecord[] => [
    { kind: 'style', move: { x, y: -x - size } },
    { kind: 'line', dx: size, dy: 0 },
    { kind: 'line', dx: 0, dy: size },
    { kind: 'line', dx: -size, dy: 0 },
    { kind: 'line', dx: 0, dy: -size },
  ];
  const [first, ...rest] = square(0, 100);
  return {
    fillBits: 1,
    lineBits: 0,
    records: [{ ...first!, fill1: 1 } as ShapeRecord, ...rest, ...square(30, 40)],
  };
};

describe('glyph contours', () => {
  it('round-trip a shape exactly', () => {
    const shape = shapeOf(ghe(10, 400, 700, 90));
    expect(outlineToShape(shapeToOutline(shape)!)).toEqual(shape);
  });
});

describe('emboldenOutline', () => {
  it('grows a box by the offset on every side', () => {
    const grown = outlineBounds(emboldenOutline(outlineOf(box(0, 100, -100)), 10));
    expect(grown).toEqual({ xMin: -10, xMax: 110, yMin: -110, yMax: 10 });
  });

  it('shrinks a counter instead of growing it, whatever its winding', () => {
    const bold = emboldenOutline(shapeToOutline(ring())!, 5);
    // Across the middle: outer left, counter left, counter right, outer right.
    expect(outlineCrossings(bold, -50)).toEqual([-5, 35, 65, 105]);
  });

  it('thins with a negative offset, and only sideways when asked', () => {
    const thin = outlineBounds(emboldenOutline(outlineOf(box(0, 100, -100)), -10, 0));
    expect(thin).toEqual({ xMin: 10, xMax: 90, yMin: -100, yMax: 0 });
  });
});

describe('fitOutline', () => {
  it('matches height, stem and baseline of the target at once', () => {
    // Donor «Н» as a box 440 wide and 770 tall, standing 20 units up; target «H» 328 × 700.
    const donor = outlineOf(box(200, 640, -790, -20));
    const fit = fitFactors({ height: 700, stem: 328, foot: 0 }, stemMetrics(donor)!);
    const fitted = fitOutline(donor, { ...fit, left: 60, right: 60 });

    expect(fitted.bounds.yMin).toBeCloseTo(-700, -1);
    expect(fitted.bounds.yMax).toBeCloseTo(0, -1);
    expect(fitted.bounds.xMax - fitted.bounds.xMin).toBeCloseTo(328, -1);
    expect(fitted.bounds.xMin).toBe(60);
    expect(fitted.advance).toBe(Math.round(fitted.bounds.xMax + 60));
  });

  it('centres a letter in a monospace cell and condenses one too wide for it', () => {
    const donor = outlineOf(box(0, 1000, -700));
    const fitted = fitOutline(donor, {
      foot: 0,
      delta: 0,
      scale: 1,
      left: 0,
      right: 0,
      mono: { advance: 600, maxInk: 540, stem: 100 },
    });
    const width = fitted.bounds.xMax - fitted.bounds.xMin;

    // Condensed no further than three quarters; the cell widens for the rest.
    expect(width).toBeCloseTo(750, -1);
    expect(fitted.advance).toBe(Math.round(750 / 0.9));
    expect(fitted.bounds.xMin).toBeCloseTo((fitted.advance - width) / 2, 0);
  });
});

describe('glyph composition', () => {
  it('stretches a hyphen into a dash of the asked width', () => {
    const dash = shapeBounds(stretchGlyphX(shapeOf(box(40, 240, -300, -240)), 800)!);
    expect(dash).toEqual({ xMin: 40, xMax: 840, yMin: -300, yMax: -240 });
  });

  it('repeats a period into an ellipsis', () => {
    const dots = repeatGlyph(shapeOf(box(40, 110, -70)), 3, 150)!;
    expect(shapeBounds(dots)).toEqual({ xMin: 40, xMax: 410, yMin: -70, yMax: 0 });
    expect(dots.records.filter((r) => r.kind === 'style')).toHaveLength(3);
  });

  it('stands the upturn of «Ґ» on the bar, as thick as the stem, without overlap', () => {
    const shape = shapeOf(ghe(0, 400, 700, 90));
    const upturned = shapeToOutline(addJoinedUpturn(shape)!)!;
    const added = upturned.contours[upturned.contours.length - 1]!;
    const addedBox = outlineBounds({ ...upturned, contours: [added] });

    expect(addedBox.yMax).toBe(-700);
    // The bar is sampled every 0.5 % of its length, so the upturn ends within a step of it.
    expect(addedBox.xMax).toBeGreaterThanOrEqual(398);
    expect(addedBox.xMax - addedBox.xMin).toBe(90);
    expect(addedBox.yMin).toBe(-700 - Math.round(700 * 0.25));
  });

  it('keeps the upturn inside the top limit, or gives up', () => {
    const shape = shapeOf(ghe(0, 400, 700, 90));
    const limited = shapeBounds(addJoinedUpturn(shape, -760)!);

    expect(limited.yMin).toBe(-760);
    expect(addJoinedUpturn(shape, -700)).toBeNull();
    expect(addJoinedUpturn(shapeOf(box(0, 400, -700)))).toBeNull();
  });
});
