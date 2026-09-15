import { installVoiceTools, type InstallVoiceToolsResult } from './installVoiceTools';

export type InstallToolsResult = {
  voice: InstallVoiceToolsResult;
};

export type InstallToolsOptions = {
  force?: boolean;
  gameDir?: string;
};

/**
 * Install disk voice tools (Fonix, xWMA, ffmpeg).
 * FaceFXWrapper and Champollion are baked into Docker images.
 */
export const installTools = async (opts?: InstallToolsOptions): Promise<InstallToolsResult> => {
  const gameDirs = opts?.gameDir?.trim() ? [opts.gameDir.trim()] : [];
  const voice = await installVoiceTools({ force: opts?.force, gameDirs });
  return { voice };
};
