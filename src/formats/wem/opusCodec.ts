/**
 * WEM Opus as a {@link WemTakeCodec}: the Opus reader and writer of this
 * folder behind the interface the voice pipeline talks to.
 */
import type { WemTakeCodec } from './codec';
import { OPUS_WEM_SAMPLE_RATE, opusWemDuration, parseOpusWem } from './opusWem';
import { WEM_OPUS_FORMAT_TAG } from './riff';
import { decodeOpusWemToWav, encodeAudioToOpusWem, type EncodeOpusWemOptions } from './transcode';

/**
 * Container fields to mirror from the take being replaced: its `fmt ` extras
 * when it is mono like the new one, and whether it has a `hash` chunk at all.
 * A source that is not WEM Opus gives none — the defaults apply.
 */
const mirrorSourceTake = (sourceTake: Buffer | null): EncodeOpusWemOptions => {
  if (!sourceTake) return {};
  try {
    const source = parseOpusWem(sourceTake);
    return {
      ...(source.channels === 1 ? { template: source } : {}),
      ...(source.hasHashChunk ? {} : { hash: null }),
    };
  } catch {
    return {};
  }
};

export const OPUS_WEM_CODEC: WemTakeCodec = {
  id: 'opus',
  formatTag: WEM_OPUS_FORMAT_TAG,

  decodeToWav: (take, outputPath, { sampleRate }) =>
    decodeOpusWemToWav(take, outputPath, { sampleRate }),

  // Opus runs at 48 kHz whatever went in: a WAV at that rate is encoded sample
  // for sample, and the take's length is the WAV's.
  takeSampleRate: () => OPUS_WEM_SAMPLE_RATE,

  encodeFromWav: (wavPath, { sourceTake }) =>
    encodeAudioToOpusWem(wavPath, mirrorSourceTake(sourceTake)),

  durationSeconds: (take) => opusWemDuration(parseOpusWem(take)),
};
