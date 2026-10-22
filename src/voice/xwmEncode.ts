import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from '../utils/file';
import { encodeXwmViaRemote } from './bethesdaTools';
import { ensureDependencyHealthy } from '../pipeline/waitForHealthy';
import { servicePool } from '../services/pools';

/**
 * Encode a 44.1 kHz mono WAV into xWMA for Bethesda voice archives.
 *
 * xWMAEncode runs in a bethesda-tools instance, from the same `tools` pool FaceFX uses.
 */
export const encodeWavToXwm = async (wavPath: string, xwmPath: string): Promise<void> => {
  ensureDir(path.dirname(xwmPath));
  if (fs.existsSync(xwmPath)) fs.unlinkSync(xwmPath);

  const tools = servicePool('tools');
  if (tools.hosts().length === 0) {
    throw new Error('No bethesda-tools instance: none in the fleet and BETHESDA_TOOLS_URL unset');
  }
  await ensureDependencyHealthy('tools');
  await tools.run((host) => encodeXwmViaRemote(host, wavPath, xwmPath));

  if (!fs.existsSync(xwmPath)) {
    throw new Error(`xWMAEncode did not create XWM: ${xwmPath}`);
  }
};
