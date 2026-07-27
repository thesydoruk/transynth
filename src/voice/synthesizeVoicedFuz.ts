import fs from 'node:fs';
import path from 'node:path';
import { writeFuz } from '../formats/fuz';
import type { GameType } from '../types';
import { generateLipFile } from './faceFx';
import { convertToFo4Wav, writeTempWav } from './ffmpegAudio';
import { matchTtsLoudnessToEnglish } from './loudness/matchTtsLoudness';
import { encodeWavToXwm } from './xwmEncode';

const voiceStem = (fileName: string): string => fileName.replace(/\.(fuz|wav|xwm)$/i, '');

export type BuiltVoicedFuz = {
  fuzData: Buffer;
  /** Loudness-matched FO4 WAV used for encode (browser preview). */
  previewWav: Buffer;
};

/**
 * Build a Bethesda `.fuz` from raw TTS WAV bytes (loudness match + LIP + xWMA).
 * `englishRefWavPath` is the same line's English audio (any ffmpeg-decodable format).
 */
export const buildVoicedFuzFromTtsWav = async (
  game: GameType,
  ttsWavBytes: Buffer,
  workDir: string,
  fileName: string,
  translation: string,
  englishRefWavPath: string,
): Promise<BuiltVoicedFuz> => {
  const stem = voiceStem(fileName);
  const rawWav = path.join(workDir, `${stem}.raw.wav`);
  const fo4Wav = path.join(workDir, `${stem}.fo4.wav`);
  const enFo4Wav = path.join(workDir, `${stem}.en.fo4.wav`);
  const xwmPath = path.join(workDir, `${stem}.xwm`);
  const lipPath = path.join(workDir, `${stem}.lip`);

  writeTempWav(rawWav, ttsWavBytes);
  await convertToFo4Wav(rawWav, fo4Wav);
  await convertToFo4Wav(englishRefWavPath, enFo4Wav);
  matchTtsLoudnessToEnglish(fo4Wav, enFo4Wav);

  await encodeWavToXwm(fo4Wav, xwmPath);
  await generateLipFile(game, fo4Wav, lipPath, translation);

  return {
    fuzData: writeFuz(fs.readFileSync(lipPath), fs.readFileSync(xwmPath)),
    previewWav: fs.readFileSync(fo4Wav),
  };
};
