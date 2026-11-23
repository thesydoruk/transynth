import path from 'node:path';
import type { GameId } from '../../types';
import { log } from '../../logger';
import { ensureDir } from '../../utils/file';
import { generateFfxanimViaRemote } from '../bethesdaTools';
import { ensureDependencyHealthy } from '../../pipeline/waitForHealthy';
import { servicePool } from '../../services/pools';

/** Which of the title's human face rigs animates the line: the voice type's sex. */
export type FaceFxActorSex = 'male' | 'female';

/**
 * WAV + spoken text -> `.ffxanim` for the title's human face rig, via the bethesda-tools
 * service (the Creation Kit's LipGenerator and ffxc under Wine, `POST /v1/ffxanim`).
 *
 * Same pool and health wait as `generateLipFile`. The target's base name (the take's
 * WEM id) becomes the animation name inside the file, as the Creation Kit names it.
 */
export const generateFfxanimFile = async (
  game: GameId,
  sourceWavPath: string,
  ffxanimPath: string,
  dialogueText: string,
  actor: FaceFxActorSex,
): Promise<void> => {
  ensureDir(path.dirname(ffxanimPath));
  const tools = servicePool('tools');
  if (tools.hosts().length === 0) {
    throw new Error('No bethesda-tools instance: none in the fleet and BETHESDA_TOOLS_URL unset');
  }
  await ensureDependencyHealthy('tools');
  await tools.run((host) =>
    generateFfxanimViaRemote(host, game, sourceWavPath, ffxanimPath, dialogueText, actor),
  );
  log.debug(`FaceFX ffxanim ${path.basename(ffxanimPath)}`);
};
