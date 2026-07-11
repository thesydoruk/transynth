import fs from 'node:fs';
import path from 'node:path';
import { writeFuz } from '../formats/fuz';
import { synthesizeXttsWav } from '../tts/xttsClient';
import type { GameType } from '../types';
import { convertToFo4Wav, writeTempWav } from './ffmpegAudio';
import { generateLipFile } from './faceFxLipGen';
import { encodeWavToXwm } from './xwmEncode';
import type { VoiceFileEntry } from './discoverVoiceFiles';

export type SynthesizedVoice = {
  fuz: Buffer;
  ttsWav: Buffer;
};

/** Synthesize one localized voiced line: XTTS → FO4 WAV → LIP + XWM → FUZ. */
export const synthesizeVoicedLine = async (
  game: GameType,
  entry: VoiceFileEntry,
  translation: string,
  referenceWavPath: string,
  speakerText: string | null,
  workDir: string,
  xttsBaseUrl: string,
  xttsLanguage: string,
): Promise<SynthesizedVoice> => {
  const stem = `${entry.formidLower6}_${entry.variant}`;
  const rawTtsWav = path.join(workDir, `${stem}.tts.raw.wav`);
  const fo4Wav = path.join(workDir, `${stem}.fo4.wav`);
  const lipPath = path.join(workDir, `${stem}.lip`);
  const xwmPath = path.join(workDir, `${stem}.xwm`);

  const ttsBytes = await synthesizeXttsWav(translation, referenceWavPath, {
    baseUrl: xttsBaseUrl,
    language: xttsLanguage,
    speakerText: speakerText ?? undefined,
  });
  writeTempWav(rawTtsWav, ttsBytes);
  await convertToFo4Wav(rawTtsWav, fo4Wav);
  await generateLipFile(game, fo4Wav, lipPath, translation);
  await encodeWavToXwm(fo4Wav, xwmPath);

  const lip = fs.readFileSync(lipPath);
  const xwm = fs.readFileSync(xwmPath);
  return { fuz: writeFuz(lip, xwm), ttsWav: ttsBytes };
};
