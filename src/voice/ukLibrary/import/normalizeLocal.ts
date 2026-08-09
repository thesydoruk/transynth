import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from '../../../utils/file';
import { decodeAudioToReferenceWav } from '../../ffmpegAudio';

/** Normalize a local audio file to a mono 22.05 kHz reference WAV. */
export const normalizeLocalReferenceClip = async (
  inputPath: string,
  wavOutPath: string,
): Promise<void> => {
  ensureDir(path.dirname(wavOutPath));
  const tempPath = `${wavOutPath}.tmp.wav`;
  try {
    await decodeAudioToReferenceWav(inputPath, tempPath);
    fs.renameSync(tempPath, wavOutPath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
};
