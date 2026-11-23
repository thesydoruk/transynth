/**
 * The audio codec inside a `.wem` voice take, as the voice pipeline uses it:
 * decode a source take to WAV, encode a WAV into a take.
 *
 * Wwise packs several codecs into the same RIFF shell and a title's takes use
 * one of them. Which one a title *writes* is that title's data
 * ({@link WemCodecId}); which one a file on disk *is* is read off its `fmt `
 * tag ({@link wemCodecOfTake}), so a take in a codec nobody implemented is
 * refused by name instead of being fed to a decoder for another.
 *
 * Two are implemented: WEM Opus (The Witcher 3) and Wwise Vorbis (Starfield).
 * Another is one more {@link WemTakeCodec} added to `CODECS` below and one
 * more member of {@link WemCodecId}; nothing outside this folder changes.
 */
import { OPUS_WEM_CODEC } from './opusCodec';
import { describeWem, unsupportedWemCodecMessage } from './riff';
import { VORBIS_WEM_CODEC } from './vorbisCodec';

/** Codecs a title can name for the takes it writes. */
export type WemCodecId = 'opus' | 'vorbis';

export type WemTakeCodec = {
  readonly id: WemCodecId;
  /** `fmt ` format tag of the takes this codec reads and writes. */
  readonly formatTag: number;

  /** Decode a take to a mono 16-bit WAV at `sampleRate`. */
  decodeToWav(take: Buffer, outputPath: string, options: { sampleRate: number }): Promise<void>;

  /**
   * Sample rate of the mono 16-bit WAV {@link WemTakeCodec.encodeFromWav}
   * wants, so the caller can prepare one file and time everything else (the
   * lip animation) on exactly the samples that get encoded. `sourceTake` is
   * the take being replaced, for a codec that keeps its rate.
   */
  takeSampleRate(sourceTake: Buffer | null): number;

  /**
   * Encode a mono 16-bit WAV at {@link WemTakeCodec.takeSampleRate} into a
   * take. `sourceTake` is the take being replaced; the codec mirrors whatever
   * container fields of it the engine may care about.
   */
  encodeFromWav(wavPath: string, options: { sourceTake: Buffer | null }): Promise<Buffer>;

  /** Seconds the take plays, as its own header states it. */
  durationSeconds(take: Buffer): number;
};

const CODECS: Record<WemCodecId, WemTakeCodec> = {
  opus: OPUS_WEM_CODEC,
  vorbis: VORBIS_WEM_CODEC,
};

/** The codec a title named. */
export const wemTakeCodec = (id: WemCodecId): WemTakeCodec => CODECS[id];

/**
 * The codec of a take on disk, by its `fmt ` tag. Throws for a codec with no
 * implementation — PCM, ADPCM, anything else — naming the tag.
 */
export const wemCodecOfTake = (take: Buffer): WemTakeCodec => {
  const description = describeWem(take);
  const codec = Object.values(CODECS).find(
    (candidate) => candidate.formatTag === description.formatTag,
  );
  if (!codec) throw new Error(unsupportedWemCodecMessage(description));
  return codec;
};
