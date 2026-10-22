import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from '../utils/file';
import { encodeXwmViaRemote } from './bethesdaTools';
import { ensureDependencyHealthy } from '../pipeline/waitForHealthy';
import { servicePool } from '../services/pools';
import { execVoiceToolAsync } from './voiceExec';
import { resolveXwmaEncodePath } from './voiceToolPaths';

/** Encode a 44.1 kHz mono WAV into xWMA for Bethesda voice archives. */
export const encodeWavToXwm = async (wavPath: string, xwmPath: string): Promise<void> => {
  ensureDir(path.dirname(xwmPath));
  if (fs.existsSync(xwmPath)) fs.unlinkSync(xwmPath);

  // Same source of instances as FaceFX: the `tools` pool (fleet rows + BETHESDA_TOOLS_URL).
  const tools = servicePool('tools');
  if (tools.hosts().length > 0) {
    await ensureDependencyHealthy('tools');
    await tools.run((host) => encodeXwmViaRemote(host, wavPath, xwmPath));
  } else if (process.platform === 'win32') {
    await execVoiceToolAsync(resolveXwmaEncodePath(), ['-b', '48000', wavPath, xwmPath]);
  } else {
    throw new Error('No bethesda-tools instance: none in the fleet and BETHESDA_TOOLS_URL unset');
  }

  if (!fs.existsSync(xwmPath)) {
    throw new Error(`xWMAEncode did not create XWM: ${xwmPath}`);
  }
};
