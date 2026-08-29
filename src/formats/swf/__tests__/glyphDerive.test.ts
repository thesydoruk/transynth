import { describe, it, expect } from '@jest/globals';
import { addUpturn, mirrorGlyphX } from '../glyphDerive';
import { shapeBounds, type GlyphShape } from '../glyphShape';

/** A «Э»-like outline: closed, asymmetric, with one curve. */
const asymmetric: GlyphShape = {
  fillBits: 1,
  lineBits: 0,
  records: [
    { kind: 'style', move: { x: 100, y: -1000 }, fill1: 1 },
    { kind: 'line', dx: 600, dy: 0 },
    { kind: 'curve', cdx: 200, cdy: 500, adx: -200, ady: 500 },
    { kind: 'line', dx: -600, dy: 0 },
  ],
};

/** A «Г»-like outline: a stem on the left and a bar running right. */
const gheShape = (): GlyphShape => ({
  fillBits: 1,
  lineBits: 0,
  records: [
    { kind: 'style', move: { x: 0, y: -1000 }, fill1: 1 },
    { kind: 'line', dx: 600, dy: 0 },
    { kind: 'line', dx: 0, dy: 150 },
    { kind: 'line', dx: -450, dy: 0 },
    { kind: 'line', dx: 0, dy: 850 },
    { kind: 'line', dx: -150, dy: 0 },
  ],
});

describe('mirrorGlyphX', () => {
  it('keeps the glyph in the same horizontal space', () => {
    const before = shapeBounds(asymmetric);

    const after = shapeBounds(mirrorGlyphX(asymmetric));

    expect(after.xMin).toBe(before.xMin);
    expect(after.xMax).toBe(before.xMax);
    expect(after.yMin).toBe(before.yMin);
    expect(after.yMax).toBe(before.yMax);
  });

  it('flips the outline rather than leaving it as it was', () => {
    const mirrored = mirrorGlyphX(asymmetric);

    expect(mirrored.records).not.toEqual(asymmetric.records);
    expect(mirrored.records[1]).toEqual({ kind: 'line', dx: -600, dy: 0 });
  });

  it('mirrors back to the original', () => {
    expect(mirrorGlyphX(mirrorGlyphX(asymmetric)).records).toEqual(asymmetric.records);
  });
});

describe('addUpturn', () => {
  it('raises the right end of the bar with a stroke of the bar thickness', () => {
    const ghe = gheShape();

    const upturned = addUpturn(ghe)!;
    const bounds = shapeBounds(upturned);
    const before = shapeBounds(ghe);

    expect(bounds.yMin).toBeLessThan(before.yMin);
    expect(bounds.xMax).toBe(before.xMax);
    // A stroke 150 units wide, matching the bar, at the right edge.
    expect(bounds.xMax - 150).toBe(450);
  });

  it('adds one closed contour and leaves the original records untouched', () => {
    const ghe = gheShape();

    const upturned = addUpturn(ghe)!;

    expect(upturned.records.slice(0, ghe.records.length)).toEqual(ghe.records);
    expect(upturned.records.slice(ghe.records.length)).toHaveLength(5); // move + four edges
  });

  it('shortens the stroke so the outline stays within the font ascent', () => {
    const ghe = gheShape();
    const top = shapeBounds(ghe).yMin;

    const limited = addUpturn(ghe, top - 60)!;

    expect(shapeBounds(limited).yMin).toBe(top - 60);
  });

  it('gives up when there is no room for a stroke', () => {
    const top = shapeBounds(gheShape()).yMin;

    expect(addUpturn(gheShape(), top)).toBeNull();
    expect(addUpturn({ fillBits: 1, lineBits: 0, records: [] })).toBeNull();
  });
});
