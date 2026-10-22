import path from 'node:path';
import type { GameId } from '../../types';
import { log } from '../../logger';
import { ensureDir } from '../../utils/file';
import { generateLipViaRemote } from '../bethesdaTools';
import { ensureDependencyHealthy } from '../../pipeline/waitForHealthy';
import { servicePool } from '../../services/pools';

/**
 * Generate a fresh LIP file from synthesized dialogue audio and translated text.
 *
 * FaceFX runs in a bethesda-tools instance (FaceFXWrapper under Wine): the `tools` pool
 * holds the fleet's managed instances and, when set, `BETHESDA_TOOLS_URL`. Inside a job
 * the call waits for a healthy instance the way TTS calls do.
 */
export const generateLipFile = async (
  game: GameId,
  sourceWavPath: string,
  lipPath: string,
  dialogueText: string,
): Promise<void> => {
  ensureDir(path.dirname(lipPath));
  const tools = servicePool('tools');
  if (tools.hosts().length === 0) {
    throw new Error('No bethesda-tools instance: none in the fleet and BETHESDA_TOOLS_URL unset');
  }
  await ensureDependencyHealthy('tools');
  await tools.run((host) => generateLipViaRemote(host, game, sourceWavPath, lipPath, dialogueText));
  log.debug(`FaceFX remote ${path.basename(lipPath)}`);
};
