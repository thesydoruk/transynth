/**
 * A `.wem` take as plain audio, for the places that listen to a source take:
 * the TTS reference, the speaker-reference cache, the editor's preview.
 *
 * The codec is read off the file's own `fmt ` tag, not assumed from the game:
 * a take in a codec without an implementation fails with the codec's name and
 * tag — never with whatever ffmpeg makes of bytes it cannot parse. The message
 * carries no file name: callers add the take's path, and per-file text would
 * stop a job's warnings from grouping.
 */
import fs from 'node:fs';
import path from 'node:path';
import { wemCodecOfTake } from '../formats/wem';
import { ensureDir } from '../utils/file';

/** Decode a `.wem` take to a mono 16-bit WAV at `sampleRate`. */
export const decodeWemTakeToWav = async (
  takePath: string,
  outputPath: string,
  sampleRate: number,
): Promise<void> => {
  ensureDir(path.dirname(outputPath));
  const take = fs.readFileSync(takePath);
  await wemCodecOfTake(take).decodeToWav(take, outputPath, { sampleRate });
};
