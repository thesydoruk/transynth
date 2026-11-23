/**
 * Wwise Vorbis as a {@link WemTakeCodec}: the reader and writer of this folder
 * behind the interface the voice pipeline talks to.
 */
import type { WemTakeCodec } from './codec';
import { describeWem, WEM_VORBIS_FORMAT_TAG } from './riff';
import { decodeVorbisWemToWav, encodeWavToVorbisWem } from './vorbisTranscode';
import { parseVorbisWem, vorbisWemDuration } from './vorbisWem';

/** Sample rate of nearly all of the game's takes, and of a take that replaces none. */
export const VORBIS_WEM_SAMPLE_RATE = 44100;

/**
 * Rates at which libvorbis produces the setup the game's own mono takes have.
 * The game ships takes at all three; a new take keeps the rate of the one it
 * replaces when it is one of them.
 */
const TAKE_SAMPLE_RATES = new Set([32000, 44100, 48000]);

const sourceSampleRate = (sourceTake: Buffer | null): number | null => {
  if (!sourceTake) return null;
  try {
    return describeWem(sourceTake).sampleRate;
  } catch {
    return null;
  }
};

export const VORBIS_WEM_CODEC: WemTakeCodec = {
  id: 'vorbis',
  formatTag: WEM_VORBIS_FORMAT_TAG,

  decodeToWav: (take, outputPath, { sampleRate }) =>
    decodeVorbisWemToWav(take, outputPath, { sampleRate, channels: 1 }),

  takeSampleRate: (sourceTake) => {
    const rate = sourceSampleRate(sourceTake);
    return rate !== null && TAKE_SAMPLE_RATES.has(rate) ? rate : VORBIS_WEM_SAMPLE_RATE;
  },

  // Nothing of the source take is mirrored beyond its rate: every container
  // field of a Wwise Vorbis take follows from the audio and the setup.
  encodeFromWav: (wavPath) => encodeWavToVorbisWem(wavPath),

  durationSeconds: (take) => vorbisWemDuration(parseVorbisWem(take)),
};
