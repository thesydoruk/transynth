/**
 * Just enough Ogg to move Opus packets in and out of ffmpeg.
 *
 * A Witcher 3 take stores bare Opus packets (see `opusWem.ts`); ffmpeg and
 * libopus speak Ogg Opus. These two functions are the bridge: wrap the game's
 * packets so ffmpeg can decode them, and unwrap what libopus encoded so the
 * packets can go back into a take.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    table[i] = r >>> 0;
  }
  return table;
})();

const oggCrc = (page: Buffer): number => {
  let crc = 0;
  for (const byte of page) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
  return crc;
};

const FLAG_BOS = 0x02;
const FLAG_EOS = 0x04;
/** Packets per page; small enough that no page's lacing table overflows 255 entries. */
const PACKETS_PER_PAGE = 50;

const buildPage = (
  serial: number,
  sequence: number,
  granule: bigint,
  flags: number,
  packets: readonly Buffer[],
): Buffer => {
  const lacing: number[] = [];
  for (const packet of packets) {
    let left = packet.length;
    while (left >= 255) {
      lacing.push(255);
      left -= 255;
    }
    lacing.push(left);
  }
  const header = Buffer.alloc(27 + lacing.length);
  header.write('OggS', 0, 'latin1');
  header[5] = flags;
  header.writeBigInt64LE(granule, 6);
  header.writeUInt32LE(serial, 14);
  header.writeUInt32LE(sequence, 18);
  header[26] = lacing.length;
  lacing.forEach((value, i) => (header[27 + i] = value));
  const page = Buffer.concat([header, ...packets]);
  page.writeUInt32LE(oggCrc(page), 22);
  return page;
};

export type OggOpusStream = {
  channels: number;
  /** Samples libopus prepends and a decoder drops, at 48 kHz. */
  preSkip: number;
  packets: Buffer[];
  /** Granule position of the last page: preSkip + the stream's sample count. */
  finalGranule: bigint;
};

/** Wrap bare Opus packets (fixed `frameSize` samples each) as an Ogg Opus file. */
export const muxOggOpus = (
  packets: readonly Buffer[],
  options: { channels: number; preSkip: number; sampleRate?: number; frameSize: number },
): Buffer => {
  const head = Buffer.alloc(19);
  head.write('OpusHead', 0, 'latin1');
  head[8] = 1;
  head[9] = options.channels;
  head.writeUInt16LE(options.preSkip, 10);
  head.writeUInt32LE(options.sampleRate ?? 48000, 12);
  const vendor = Buffer.from('transynth', 'latin1');
  const tags = Buffer.alloc(8 + 4 + vendor.length + 4);
  tags.write('OpusTags', 0, 'latin1');
  tags.writeUInt32LE(vendor.length, 8);
  vendor.copy(tags, 12);

  const pages = [buildPage(1, 0, 0n, FLAG_BOS, [head]), buildPage(1, 1, 0n, 0, [tags])];
  let granule = 0n;
  for (let i = 0, sequence = 2; i < packets.length; i += PACKETS_PER_PAGE, sequence++) {
    const chunk = packets.slice(i, i + PACKETS_PER_PAGE);
    granule += BigInt(chunk.length * options.frameSize);
    const last = i + PACKETS_PER_PAGE >= packets.length;
    pages.push(buildPage(1, sequence, granule, last ? FLAG_EOS : 0, chunk));
  }
  return Buffer.concat(pages);
};

/** Read the packets of a single-stream Ogg Opus file, as libopus writes it. */
export const demuxOggOpus = (ogg: Buffer): OggOpusStream => {
  const all: Buffer[] = [];
  let pending: Buffer[] = [];
  let finalGranule = 0n;
  let pos = 0;
  while (pos < ogg.length) {
    if (ogg.toString('latin1', pos, pos + 4) !== 'OggS') throw new Error(`Bad Ogg page at ${pos}`);
    const segments = ogg[pos + 26]!;
    const lacing = ogg.subarray(pos + 27, pos + 27 + segments);
    const granule = ogg.readBigInt64LE(pos + 6);
    if (granule >= 0n) finalGranule = granule;
    let body = pos + 27 + segments;
    for (const size of lacing) {
      pending.push(ogg.subarray(body, body + size));
      body += size;
      if (size < 255) {
        all.push(Buffer.concat(pending));
        pending = [];
      }
    }
    pos = body;
  }
  const head = all[0];
  if (!head || head.toString('latin1', 0, 8) !== 'OpusHead')
    throw new Error('Not an Ogg Opus stream');
  return {
    channels: head[9]!,
    preSkip: head.readUInt16LE(10),
    // Packet 1 is OpusTags; audio starts after it.
    packets: all.slice(2),
    finalGranule,
  };
};
