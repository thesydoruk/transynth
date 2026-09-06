import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from '../utils/file';
import { encodeXwmViaRemote, resolveBethesdaToolsUrl } from './bethesdaTools';
import { execVoiceToolAsync } from './voiceExec';
import { resolveXwmaEncodePath } from './voiceToolPaths';

/** Encode a 44.1 kHz mono WAV into xWMA for Bethesda voice archives. */
export const encodeWavToXwm = async (wavPath: string, xwmPath: string): Promise<void> => {
  ensureDir(path.dirname(xwmPath));
  if (fs.existsSync(xwmPath)) fs.unlinkSync(xwmPath);

  const remoteUrl = resolveBethesdaToolsUrl();
  if (remoteUrl) {
    await encodeXwmViaRemote(remoteUrl, wavPath, xwmPath);
  } else if (process.platform === 'win32') {
    await execVoiceToolAsync(resolveXwmaEncodePath(), ['-b', '48000', wavPath, xwmPath]);
  } else {
    throw new Error('BETHESDA_TOOLS_URL is not set');
  }

  if (!fs.existsSync(xwmPath)) {
    throw new Error(`xWMAEncode did not create XWM: ${xwmPath}`);
  }
};
