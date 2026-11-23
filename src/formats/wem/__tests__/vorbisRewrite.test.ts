/**
 * The Wwise ⇄ standard Vorbis rewrite on its own: bit packing, the codebook
 * table, the container checks. No audio is encoded here (see
 * `vorbisWem.test.ts`).
 */
import { describe, expect, it } from '@jest/globals';
import { BitReader, BitWriter } from '../bits';
import { parseCodebookLibrary, rewriteCodebook, wwiseCodebookLibrary } from '../vorbisCodebook';
import { FieldRewriter, fnv1Hash32, ilog } from '../vorbisFields';
import {
  audioPacketsToStandard,
  audioPacketsToWwise,
  buildIdentificationHeader,
  packetSampleCounts,
  parseIdentificationHeader,
} from '../vorbisPackets';
import type { VorbisModes } from '../vorbisSetup';
import { parseVorbisWem } from '../vorbisWem';

/** A RIFF/WAVE file from chunks; `fmt ` carries only what a test sets. */
const riffOf = (chunks: Array<[string, Buffer]>): Buffer => {
  const body = Buffer.concat(
    chunks.map(([id, data]) => {
      const head = Buffer.alloc(8);
      head.write(id, 0, 'latin1');
      head.writeUInt32LE(data.length, 4);
      return Buffer.concat([head, data]);
    }),
  );
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'latin1');
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write('WAVE', 8, 'latin1');
  return Buffer.concat([riff, body]);
};

const vorbisFmt = (size: number, blockSizeBits: [number, number] = [8, 11]): Buffer => {
  const fmt = Buffer.alloc(size);
  fmt.writeUInt16LE(0xffff, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(44100, 4);
  if (size >= 0x42) {
    fmt[0x40] = blockSizeBits[0];
    fmt[0x41] = blockSizeBits[1];
  }
  return fmt;
};

describe('Vorbis bit packing', () => {
  it('packs fields least significant bit first, across byte borders', () => {
    const writer = new BitWriter();
    writer.write(1, 1);
    writer.write(3, 0b010);
    writer.write(10, 0x2a5);
    writer.write(32, 0xdeadbeef);
    writer.write(0, 0);
    expect(writer.position).toBe(46);
    const bytes = writer.toBuffer();
    expect(bytes).toHaveLength(6);
    expect(bytes[0]).toBe(0b0101_0101); // 1, then 010, then the low four bits of 0x2a5

    const reader = new BitReader(bytes);
    expect([reader.read(1), reader.read(3), reader.read(10), reader.read(32)]).toEqual([
      1, 0b010, 0x2a5, 0xdeadbeef,
    ]);
    expect(reader.bitsLeft).toBe(2);
    expect(() => reader.read(3)).toThrow(/ends inside a field/);
    expect(() => writer.write(3, 8)).toThrow(/does not fit a 3-bit/);
  });

  it('copies a stretch of bits whatever the alignment', () => {
    const source = Buffer.from('0123456789abcdef', 'latin1');
    const reader = new BitReader(source);
    reader.seek(5);
    const writer = new BitWriter();
    writer.write(3, 0);
    writer.copy(reader, source.length * 8 - 5);
    const back = new BitReader(writer.toBuffer());
    back.seek(3);
    const again = new BitReader(source);
    again.seek(5);
    while (again.bitsLeft >= 7) expect(back.read(7)).toBe(again.read(7));
  });

  it('computes ilog and the Audiokinetic FNV-1 hash', () => {
    expect([0, 1, 2, 7, 8, 1023].map(ilog)).toEqual([0, 1, 2, 3, 4, 10]);
    expect(fnv1Hash32([])).toBe(0x811c9dc5);
    // FNV-1 (multiply, then xor) of "a": the published test vector.
    expect(fnv1Hash32(Buffer.from('a'))).toBe(0x050c5d7e);
  });
});

describe('the Wwise codebook table', () => {
  const library = wwiseCodebookLibrary();

  it('rebuilds every codebook to a standard one and strips it back', () => {
    expect(library.size).toBe(598);
    let repeated = 0;
    for (let id = 0; id < library.size; id++) {
      const standard = new BitWriter();
      library.rebuild(id, standard);
      const bytes = standard.toBuffer();
      expect(bytes.readUIntLE(0, 3)).toBe(0x564342);

      const ids = library.find(bytes, 0, standard.position);
      expect(ids).toContain(id);
      if (ids.length > 1) repeated++;

      // Standard → Wwise → standard is the identity.
      const packed = new BitWriter();
      rewriteCodebook(new FieldRewriter(new BitReader(bytes), packed, 'toWwise'));
      const again = new BitWriter();
      rewriteCodebook(new FieldRewriter(new BitReader(packed.toBuffer()), again, 'toStandard'));
      expect(again.position).toBe(standard.position);
      expect(again.toBuffer().equals(bytes)).toBe(true);
    }
    // Neighbouring quality levels share codebooks; the table lists them twice.
    expect(repeated).toBeGreaterThan(0);
  });

  it('refuses an id outside the table and finds nothing for a foreign codebook', () => {
    expect(() => library.rebuild(598, new BitWriter())).toThrow(/id 598 is not in the aoTuV 6\.03/);
    expect(library.find(Buffer.from('not a codebook at all'), 0, 160)).toEqual([]);
    expect(() => parseCodebookLibrary(Buffer.alloc(4))).toThrow(/Bad Wwise codebook table/);
  });

  it('refuses a standard codebook Wwise has no field for', () => {
    // 17 dimensions do not fit Wwise's four bits.
    const wide = new BitWriter();
    wide.write(24, 0x564342);
    wide.write(16, 17);
    wide.write(24, 1);
    const rewrite = (): void =>
      rewriteCodebook(
        new FieldRewriter(new BitReader(wide.toBuffer()), new BitWriter(), 'toWwise'),
      );
    expect(rewrite).toThrow(/codebook dimensions 17 does not fit Wwise's 4-bit field/);

    const unsynced = Buffer.from('xyz and more', 'latin1');
    expect(() =>
      rewriteCodebook(new FieldRewriter(new BitReader(unsynced), new BitWriter(), 'toWwise')),
    ).toThrow(/codebook sync pattern/);
  });
});

describe('Vorbis audio packets', () => {
  const modes: VorbisModes = { longBlock: [false, true], modeBits: 1 };
  // Wwise form: mode bit, then payload. Short, long, long, short.
  const wwise = [
    Buffer.from([0b1010_1010, 0x11]),
    Buffer.from([0b0101_0101, 0x22]),
    Buffer.from([0b0000_0001, 0x33]),
    Buffer.from([0b1111_1110]),
  ];

  it('puts the type bit and the window flags back, and takes them out again', () => {
    const standard = audioPacketsToStandard(wwise, modes);
    // Short block: type 0, mode 0, then the other seven bits of the first byte.
    expect(standard[0]![0]).toBe(0b0101_0100);
    // Long block after a short one, before a long one: type 0, mode 1, previous 0, next 1.
    expect(standard[1]![0]! & 0b1111).toBe(0b1010);
    // Long block between a long and a short one: previous 1, next 0.
    expect(standard[2]![0]! & 0b1111).toBe(0b0110);
    // One or three bits more than a whole number of bytes: one byte longer.
    expect(standard.map((packet) => packet.length)).toEqual([3, 3, 3, 2]);

    const back = audioPacketsToWwise(standard, modes);
    back.forEach((packet, i) => {
      expect(packet.subarray(0, wwise[i]!.length).equals(wwise[i]!)).toBe(true);
      expect(packet.subarray(wwise[i]!.length).every((byte) => byte === 0)).toBe(true);
    });
  });

  it('counts the samples each packet adds', () => {
    expect(packetSampleCounts([false, true, true, false], [8, 11])).toEqual([0, 576, 1024, 576]);
    expect(packetSampleCounts([false, false], [8, 11])).toEqual([0, 128]);
  });

  it('refuses window flags a decoder would rebuild differently', () => {
    const standard = audioPacketsToStandard(wwise, modes);
    const wrong = Buffer.from(standard[1]!);
    wrong[0]! ^= 0b0100; // claim the block before was long
    expect(() => audioPacketsToWwise([standard[0]!, wrong, standard[2]!], modes)).toThrow(
      /packet 1 has window flags its neighbours contradict/,
    );
    expect(() => audioPacketsToWwise([Buffer.from([0x05])], modes)).toThrow(
      /packet 0 is not an audio packet/,
    );
  });

  it('writes and reads the identification header', () => {
    const id = { channels: 1, sampleRate: 44100, bitrate: 45000, blockSizeBits: [8, 11] as const };
    const header = buildIdentificationHeader(id);
    expect(header).toHaveLength(30);
    expect(header.toString('latin1', 1, 7)).toBe('vorbis');
    expect(parseIdentificationHeader(header)).toEqual(id);
    expect(() => parseIdentificationHeader(Buffer.alloc(30))).toThrow(/identification header/);
  });
});

describe('a Wwise Vorbis take that is not the game’s layout', () => {
  it('is refused saying what is different', () => {
    const data = Buffer.alloc(4);
    expect(() => parseVorbisWem(riffOf([['fmt ', vorbisFmt(18)]]))).toThrow(
      /the take is Wwise Vorbis \(fmt tag 0xffff\) in a layout that is not read: its fmt chunk has 18 bytes/,
    );
    expect(() =>
      parseVorbisWem(
        riffOf([
          ['fmt ', vorbisFmt(0x18)],
          ['vorb', Buffer.alloc(0x34)],
          ['data', data],
        ]),
      ),
    ).toThrow(/layout that is not read: it has a vorb chunk/);
    expect(() =>
      parseVorbisWem(
        riffOf([
          ['fmt ', vorbisFmt(0x42, [9, 9])],
          ['data', data],
        ]),
      ),
    ).toThrow(/its block sizes are 2\^9 and 2\^9/);
    expect(() => parseVorbisWem(riffOf([['fmt ', vorbisFmt(0x42)]]))).toThrow(/no data chunk/);
  });

  it('is refused when its packets do not add up', () => {
    const fmt = vorbisFmt(0x42);
    fmt.writeUInt32LE(0, 0x28); // no seek table
    fmt.writeUInt32LE(6, 0x2c); // audio after a 4-byte setup packet
    const setup = Buffer.from([4, 0, 1, 2, 3, 4]);
    const cut = Buffer.concat([setup, Buffer.from([9, 0, 1, 2])]);
    expect(() =>
      parseVorbisWem(
        riffOf([
          ['fmt ', fmt],
          ['data', cut],
        ]),
      ),
    ).toThrow(/bad 9-byte packet at data offset 6/);

    fmt.writeUInt32LE(7, 0x2c);
    expect(() =>
      parseVorbisWem(
        riffOf([
          ['fmt ', fmt],
          ['data', setup],
        ]),
      ),
    ).toThrow(/first audio packet does not follow the setup packet/);
  });

  it('is told apart from a take in another codec', () => {
    const opus = vorbisFmt(18);
    opus.writeUInt16LE(0x3041, 0);
    expect(() => parseVorbisWem(riffOf([['fmt ', opus]]))).toThrow(
      /the take is WEM Opus \(fmt tag 0x3041\); a Wwise Vorbis take was expected/,
    );
  });
});
