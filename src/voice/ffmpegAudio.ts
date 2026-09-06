import fs from 'node:fs';
import path from 'node:path';
import { execFileAsync } from '../utils/execFile';
import { ensureDir } from '../utils/file';
import { resolveFfmpegPath } from './voiceToolPaths';

const FO4_WAV_ARGS = ['-ac', '1', '-ar', '44100', '-sample_fmt', 's16'] as const;
/** FaceFX treats sample count as 16 kHz; 22050 made lips ~1.4× the WAV. */
const FACEFX_WAV_ARGS = ['-ac', '1', '-ar', '16000', '-sample_fmt', 's16'] as const;

/** Convert any supported audio input to mono 44.1 kHz 16-bit PCM WAV (FO4 voice pipeline). */
export const convertToFo4Wav = async (inputPath: string, outputPath: string): Promise<void> => {
  ensureDir(path.dirname(outputPath));
  await execFileAsync(resolveFfmpegPath(), ['-y', '-i', inputPath, ...FO4_WAV_ARGS, outputPath]);
};

/** Resample to mono 16 kHz PCM for FaceFX LIP input (bypasses Wine DirectShow resampler). */
export const convertToFaceFxWav = async (inputPath: string, outputPath: string): Promise<void> => {
  ensureDir(path.dirname(outputPath));
  await execFileAsync(resolveFfmpegPath(), ['-y', '-i', inputPath, ...FACEFX_WAV_ARGS, outputPath]);
};

/** Decode XWM/FUZ audio to mono WAV suitable as an XTTS reference clip. */
export const decodeAudioToReferenceWav = async (
  inputPath: string,
  outputPath: string,
): Promise<void> => {
  ensureDir(path.dirname(outputPath));
  await execFileAsync(resolveFfmpegPath(), [
    '-y',
    '-i',
    inputPath,
    '-ac',
    '1',
    '-ar',
    '22050',
    '-sample_fmt',
    's16',
    outputPath,
  ]);
};

export const writeTempWav = (outputPath: string, data: Buffer): void => {
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, data);
};
