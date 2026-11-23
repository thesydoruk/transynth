/**
 * Wwise Vorbis in and out of ffmpeg: decode a take to WAV, encode a WAV into
 * a take. ffmpeg's Vorbis decoder and libvorbis do the signal work; Wwise is
 * not involved.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileAsync } from '../../utils/execFile';
import { resolveFfmpegPath } from '../../voice/voiceToolPaths';
import { withTempDir } from './transcode';
import { oggVorbisToWem, vorbisWemToOgg } from './vorbisOgg';
import { parseVorbisWem } from './vorbisWem';

/**
 * libvorbis quality (`-q:a`) of the takes written. Quality 1 gives the setup
 * of the game's own mono takes: the same codebooks, layout and residue ranges
 * at 32, 44.1 and 48 kHz. At 32 kHz it is that setup byte for byte; at the
 * other two rates it differs in five positions of the long-block floor curve,
 * where libvorbis and the encoder Wwise is built on (aoTuV) part ways.
 * Measured on 61 of the game's takes decoded and encoded again: 55.7 kbit/s
 * against the game's 60.5.
 *
 * Any quality from 1 up to 2 keeps the structure (1.99 gives 59.1 kbit/s with
 * a wider residue range); below 1, or from 2 up, libvorbis picks other
 * codebooks, and `oggVorbisToWem` refuses the result because the decoder
 * memory such a take must state is not known.
 */
export const VORBIS_TAKE_QUALITY = 1;

/**
 * Decode a take to a WAV file: 16-bit, at the take's own rate and channels
 * unless told otherwise, and exactly as long as the take states. The rebuilt
 * stream already ends there; `atrim` holds ffmpeg to it where its own end trim
 * falls short (a stream of two packets).
 */
export const decodeVorbisWemToWav = async (
  riff: Buffer,
  outputPath: string,
  options: { sampleRate?: number; channels?: number } = {},
): Promise<void> =>
  withTempDir(async (dir) => {
    const wem = parseVorbisWem(riff);
    const ogg = path.join(dir, 'take.ogg');
    fs.writeFileSync(ogg, vorbisWemToOgg(wem));
    await execFileAsync(resolveFfmpegPath(), [
      '-y',
      '-v',
      'error',
      '-i',
      ogg,
      '-af',
      `atrim=end_sample=${wem.samples}`,
      ...(options.channels ? ['-ac', String(options.channels)] : []),
      ...(options.sampleRate ? ['-ar', String(options.sampleRate)] : []),
      '-sample_fmt',
      's16',
      outputPath,
    ]);
  });

/**
 * Encode a mono WAV into a take at the WAV's own sample rate, sample for
 * sample: the take states exactly the WAV's length.
 */
export const encodeWavToVorbisWem = async (wavPath: string): Promise<Buffer> =>
  withTempDir(async (dir) => {
    const ogg = path.join(dir, 'take.ogg');
    await execFileAsync(resolveFfmpegPath(), [
      '-y',
      '-v',
      'error',
      '-i',
      wavPath,
      '-map_metadata',
      '-1',
      '-ac',
      '1',
      '-c:a',
      'libvorbis',
      '-q:a',
      String(VORBIS_TAKE_QUALITY),
      '-f',
      'ogg',
      ogg,
    ]);
    return oggVorbisToWem(fs.readFileSync(ogg));
  });
