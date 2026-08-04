import { describe, it, expect } from '@jest/globals';
import { parseSwf, writeSwf } from '../swfTags';
import { buildSwf, tag } from './swfFixtures';

describe('parseSwf', () => {
  it('reads tags of an uncompressed container', () => {
    const swf = parseSwf(buildSwf([tag(9, Buffer.from([1, 2, 3])), tag(43, Buffer.from('x'))]));

    expect(swf.compressed).toBe(false);
    expect(swf.tags.map((t) => t.code)).toEqual([9, 43]);
    expect(swf.tags[0]!.body).toEqual(Buffer.from([1, 2, 3]));
  });

  it('inflates a CWS container and remembers to compress it again', () => {
    const swf = parseSwf(buildSwf([tag(9, Buffer.from([7]))], true));

    expect(swf.compressed).toBe(true);
    expect(swf.tags[0]!.body).toEqual(Buffer.from([7]));
  });

  it('reads long tag headers', () => {
    const long = Buffer.alloc(200, 0xab);
    const swf = parseSwf(buildSwf([tag(75, long), tag(9, Buffer.from([1]))]));

    expect(swf.tags[0]!.body).toEqual(long);
    expect(swf.tags[1]!.code).toBe(9);
  });

  it('stops at the End tag', () => {
    const withTrailingBytes = Buffer.concat([
      buildSwf([tag(9, Buffer.from([1]))]),
      Buffer.alloc(16, 0xff),
    ]);

    expect(parseSwf(withTrailingBytes).tags).toHaveLength(1);
  });

  it('rejects unsupported signatures', () => {
    expect(() => parseSwf(Buffer.from('ZWS\x0f00000000', 'ascii'))).toThrow(/ZWS/);
  });
});

describe('writeSwf', () => {
  it('round-trips tags and the frame preamble', () => {
    const original = buildSwf([tag(9, Buffer.from([1, 2])), tag(75, Buffer.alloc(120, 5))]);
    const parsed = parseSwf(original);

    const reparsed = parseSwf(writeSwf(parsed));

    expect(reparsed.preamble).toEqual(parsed.preamble);
    expect(reparsed.tags).toEqual(parsed.tags);
  });

  it('rewrites the declared file length after a tag grows', () => {
    const parsed = parseSwf(buildSwf([tag(9, Buffer.from([1]))]));
    parsed.tags[0] = { code: 9, body: Buffer.alloc(500, 3) };

    const written = writeSwf(parsed);

    expect(written.readUInt32LE(4)).toBe(written.length);
    expect(parseSwf(written).tags[0]!.body.length).toBe(500);
  });

  it('keeps zlib compression, so the declared length stays the inflated one', () => {
    const parsed = parseSwf(buildSwf([tag(9, Buffer.alloc(400, 0))], true));

    const written = writeSwf(parsed);

    expect(written.toString('ascii', 0, 3)).toBe('CWS');
    expect(written.readUInt32LE(4)).toBeGreaterThan(written.length);
    expect(parseSwf(written).tags[0]!.body.length).toBe(400);
  });
});
