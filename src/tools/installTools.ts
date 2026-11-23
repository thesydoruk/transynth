import {
  installStarfieldLipTools,
  type InstallStarfieldLipToolsResult,
} from './installStarfieldLipTools';
import { installVoiceTools, type InstallVoiceToolsResult } from './installVoiceTools';

export type InstallToolsResult = {
  voice: InstallVoiceToolsResult;
  starfield: InstallStarfieldLipToolsResult;
};

export type InstallToolsOptions = {
  force?: boolean;
  gameDir?: string;
};

/**
 * Install the voice tools that come from the user's own game installs: the Fallout /
 * Skyrim `FonixData.cdf`, and the Starfield Creation Kit's LipGenerator and ffxc when the
 * given folder has them. FaceFXWrapper, xWMAEncode and Champollion are baked into the
 * Docker images.
 */
export const installTools = async (opts?: InstallToolsOptions): Promise<InstallToolsResult> => {
  const gameDirs = opts?.gameDir?.trim() ? [opts.gameDir.trim()] : [];
  const voice = await installVoiceTools({ force: opts?.force, gameDirs });
  const starfield = installStarfieldLipTools({ force: opts?.force, gameDirs });
  return { voice, starfield };
};
