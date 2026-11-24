/**
 * The RIFF shell of a Wwise `.wem` and the codec its `fmt ` chunk names.
 *
 * Every Wwise codec shares the container and differs in the format tag, so a
 * take can be identified — and refused with a useful message — before anything
 * tries to decode it.
 */

/** Wwise "WEM Opus": bare Opus packets plus a `seek` table (Wwise 2019.2+). */
export const WEM_OPUS_FORMAT_TAG = 0x3041;
/** Wwise Vorbis: Vorbis packets with the headers stripped down (see `vorbisWem.ts`). */
export const WEM_VORBIS_FORMAT_TAG = 0xffff;

export type WemCodec = 'opus' | 'ogg-opus' | 'vorbis' | 'pcm' | 'adpcm' | 'unknown';

const CODEC_BY_TAG = new Map<number, WemCodec>([
  [WEM_OPUS_FORMAT_TAG, 'opus'],
  [0x3040, 'ogg-opus'],
  [0xffff, 'vorbis'],
  [0xfffe, 'pcm'],
  [0x0001, 'pcm'],
  [0x0002, 'adpcm'],
]);

const CODEC_LABEL: Record<WemCodec, string> = {
  opus: 'WEM Opus',
  'ogg-opus': 'Ogg Opus in a WEM',
  vorbis: 'Wwise Vorbis',
  pcm: 'PCM',
  adpcm: 'Wwise ADPCM',
  unknown: 'an unknown codec',
};

export type WemChunk = { id: string; offset: number; size: number };

/** What a `.wem` says about itself, without decoding it. */
export type WemDescription = {
  formatTag: number;
  codec: WemCodec;
  channels: number;
  sampleRate: number;
  /** Size of the `fmt ` chunk body; WEM Opus has 36. */
  fmtSize: number;
  /** Chunks in file order, e.g. `fmt `, `hash`, `seek`, `data`. */
  chunks: WemChunk[];
};

const isRiffWave = (riff: Buffer): boolean =>
  riff.length >= 12 &&
  riff.toString('latin1', 0, 4) === 'RIFF' &&
  riff.toString('latin1', 8, 12) === 'WAVE';

/** Chunk table of a RIFF/WAVE file. Wwise writes no padding between chunks. */
export const listRiffChunks = (riff: Buffer): WemChunk[] => {
  if (!isRiffWave(riff)) throw new Error('Not a RIFF/WAVE take');
  const chunks: WemChunk[] = [];
  let pos = 12;
  while (pos + 8 <= riff.length) {
    const size = riff.readUInt32LE(pos + 4);
    chunks.push({ id: riff.toString('latin1', pos, pos + 4), offset: pos + 8, size });
    pos += 8 + size;
  }
  return chunks;
};

/** Chunk bodies by id; a chunk that runs past the file is cut at its end. */
export const readRiffChunks = (riff: Buffer): Map<string, Buffer> => {
  const chunks = new Map<string, Buffer>();
  for (const chunk of listRiffChunks(riff)) {
    chunks.set(chunk.id, riff.subarray(chunk.offset, chunk.offset + chunk.size));
  }
  return chunks;
};

export const describeWem = (riff: Buffer): WemDescription => {
  const chunks = listRiffChunks(riff);
  const fmt = chunks.find((chunk) => chunk.id === 'fmt ');
  if (!fmt || fmt.size < 8 || fmt.offset + 8 > riff.length) {
    throw new Error('WEM take has no usable fmt chunk');
  }
  const formatTag = riff.readUInt16LE(fmt.offset);
  return {
    formatTag,
    codec: CODEC_BY_TAG.get(formatTag) ?? 'unknown',
    channels: riff.readUInt16LE(fmt.offset + 2),
    sampleRate: riff.readUInt32LE(fmt.offset + 4),
    fmtSize: fmt.size,
    chunks,
  };
};

const hexTag = (tag: number): string => `0x${tag.toString(16).padStart(4, '0')}`;

/** A codec by name and tag, e.g. `Wwise Vorbis (fmt tag 0xffff)`. */
export const wemCodecLabel = (description: Pick<WemDescription, 'formatTag' | 'codec'>): string =>
  `${CODEC_LABEL[description.codec]} (fmt tag ${hexTag(description.formatTag)})`;

/**
 * Why a take cannot be used, in words an operator can act on: which codec it
 * is, by name and tag, and what is missing. `expected` is for a reader of one
 * codec handed a take in another.
 */
export const unsupportedWemCodecMessage = (
  description: Pick<WemDescription, 'formatTag' | 'codec'>,
  expected?: WemCodec,
): string => {
  const reason = expected
    ? `a ${CODEC_LABEL[expected]} take was expected`
    : `no reader or writer for it is implemented: only WEM Opus (${hexTag(WEM_OPUS_FORMAT_TAG)}) and Wwise Vorbis (${hexTag(WEM_VORBIS_FORMAT_TAG)}) are (see src/formats/wem/codec.ts)`;
  return `Unsupported WEM codec: the take is ${wemCodecLabel(description)}; ${reason}.`;
};
