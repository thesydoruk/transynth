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
  const referencePath = path.join(tempDir, `${entry.lineKey}_${entry.variant}.ref.wav`);
  if (entry.ext === 'wav') {
    await decodeAudioToReferenceWav(entry.absolutePath, referencePath);
    return referencePath;
  }

  const sourceAudioPath = path.join(tempDir, `${entry.lineKey}_${entry.variant}.src.audio`);
  if (entry.ext === 'fuz') {
    let xwm: Buffer;
    try {
      xwm = extractXwmFromFuzFile(entry.absolutePath);
    } catch (err) {
      // Some mods ship plain audio under a .fuz name; let ffmpeg read it as is.
      if (!(err instanceof Error) || !/FUZ magic/.test(err.message)) throw err;
      await decodeAudioToReferenceWav(entry.absolutePath, referencePath).catch(() => {
        throw err;
      });
      return referencePath;
    }
    fs.writeFileSync(`${sourceAudioPath}.xwm`, xwm);
    await decodeAudioToReferenceWav(`${sourceAudioPath}.xwm`, referencePath);
    return referencePath;
  }

  await decodeAudioToReferenceWav(entry.absolutePath, referencePath);
  return referencePath;
};
