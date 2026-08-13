import fs from 'node:fs';
import path from 'node:path';
import { writeFuz } from '../formats/fuz';
import type { GameType } from '../types';
import { generateLipFile } from './faceFx';
import { convertToFo4Wav, writeTempWav } from './ffmpegAudio';
import { encodeWavToXwm } from './xwmEncode';

const voiceStem = (fileName: string): string => fileName.replace(/\.(fuz|wav|xwm)$/i, '');

export type BuiltVoicedFuz = {
  fuzData: Buffer;
  /** FO4 WAV used for encode (browser preview). Loudness is applied by TTS. */
  previewWav: Buffer;
};

/**
 * Build a Bethesda `.fuz` from TTS WAV bytes (FO4 convert + LIP + xWMA).
 * Speech level is already matched on the TTS server to the first speaker_wav.
 */
export const buildVoicedFuzFromTtsWav = async (
  game: GameType,
  ttsWavBytes: Buffer,
  workDir: string,
  fileName: string,
  translation: string,
): Promise<BuiltVoicedFuz> => {
  const stem = voiceStem(fileName);
  const rawWav = path.join(workDir, `${stem}.raw.wav`);
  const fo4Wav = path.join(workDir, `${stem}.fo4.wav`);
  const xwmPath = path.join(workDir, `${stem}.xwm`);
  const lipPath = path.join(workDir, `${stem}.lip`);

  writeTempWav(rawWav, ttsWavBytes);
  await convertToFo4Wav(rawWav, fo4Wav);

  await encodeWavToXwm(fo4Wav, xwmPath);
  await generateLipFile(game, fo4Wav, lipPath, translation);

  return {
    fuzData: writeFuz(fs.readFileSync(lipPath), fs.readFileSync(xwmPath)),
    previewWav: fs.readFileSync(fo4Wav),
  };
};
