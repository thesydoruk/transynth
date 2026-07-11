import fs from 'node:fs';
import path from 'node:path';
import { extractXwmFromFuzFile } from '../formats/fuz';
import { decodeAudioToReferenceWav } from './ffmpegAudio';
import type { VoiceFileEntry } from './discoverVoiceFiles';

/** Decode a voiced line asset (FUZ/XWM/WAV) into a reference WAV for XTTS. */
export const prepareReferenceAudio = async (
  entry: VoiceFileEntry,
  tempDir: string,
): Promise<string> => {
  const referencePath = path.join(tempDir, `${entry.formidLower6}_${entry.variant}.ref.wav`);
  if (entry.ext === 'wav') {
    await decodeAudioToReferenceWav(entry.absolutePath, referencePath);
    return referencePath;
  }

  const sourceAudioPath = path.join(tempDir, `${entry.formidLower6}_${entry.variant}.src.audio`);
  if (entry.ext === 'fuz') {
    const xwm = extractXwmFromFuzFile(entry.absolutePath);
    fs.writeFileSync(`${sourceAudioPath}.xwm`, xwm);
    await decodeAudioToReferenceWav(`${sourceAudioPath}.xwm`, referencePath);
    return referencePath;
  }

  await decodeAudioToReferenceWav(entry.absolutePath, referencePath);
  return referencePath;
};
