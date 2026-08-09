import fs from 'node:fs';
import path from 'node:path';
import { downloadFile } from '../../../tools/archiveUtils';
import { ensureDir } from '../../../utils/file';
import { decodeAudioToReferenceWav } from '../../ffmpegAudio';

/** Download remote audio and normalize to a mono 22.05 kHz reference WAV. */
export const downloadAndNormalizeReferenceClip = async (
  audioUrl: string,
  wavOutPath: string,
): Promise<void> => {
  ensureDir(path.dirname(wavOutPath));
  const ext = audioUrl.includes('.opus') || audioUrl.includes('audio/ogg') ? '.opus' : '.bin';
  const tempPath = `${wavOutPath}.download${ext}`;
  try {
    await downloadFile(audioUrl, tempPath);
    await decodeAudioToReferenceWav(tempPath, wavOutPath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
};
