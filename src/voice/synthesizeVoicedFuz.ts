import fs from 'node:fs';
import path from 'node:path';
import { writeFuz } from '../formats/fuz';
import type { GameType } from '../types';
import { generateLipFile } from './faceFxLipGen';
import { convertToFo4Wav, writeTempWav } from './ffmpegAudio';
import { encodeWavToXwm } from './xwmEncode';

const voiceStem = (fileName: string): string => fileName.replace(/\.(fuz|wav|xwm)$/i, '');

/**
 * Build a Bethesda `.fuz` from raw XTTS WAV bytes (LIP via FaceFX + xWMA encode).
 */
export const buildVoicedFuzFromTtsWav = async (
  game: GameType,
  ttsWavBytes: Buffer,
  workDir: string,
  fileName: string,
  translation: string,
): Promise<Buffer> => {
  const stem = voiceStem(fileName);
  const rawWav = path.join(workDir, `${stem}.raw.wav`);
  const fo4Wav = path.join(workDir, `${stem}.fo4.wav`);
  const xwmPath = path.join(workDir, `${stem}.xwm`);
  const lipPath = path.join(workDir, `${stem}.lip`);

  writeTempWav(rawWav, ttsWavBytes);
  await convertToFo4Wav(rawWav, fo4Wav);
  await encodeWavToXwm(fo4Wav, xwmPath);
  await generateLipFile(game, fo4Wav, lipPath, translation);

  return writeFuz(fs.readFileSync(lipPath), fs.readFileSync(xwmPath));
};
