import fs from 'node:fs';
import path from 'node:path';
import { execFileAsync } from '../utils/execFile';
import { ensureDir } from '../utils/file';
import { resolveXwmaEncodePath } from './voiceToolPaths';

/** Encode a 44.1 kHz mono WAV into xWMA for Bethesda voice archives. */
export const encodeWavToXwm = async (wavPath: string, xwmPath: string): Promise<void> => {
  ensureDir(path.dirname(xwmPath));
  if (fs.existsSync(xwmPath)) fs.unlinkSync(xwmPath);
  await execFileAsync(resolveXwmaEncodePath(), ['-b', '48000', wavPath, xwmPath]);
  if (!fs.existsSync(xwmPath)) {
    throw new Error(`xWMAEncode did not create XWM: ${xwmPath}`);
  }
};
