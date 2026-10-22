import fs from 'node:fs';
import path from 'node:path';
import { log } from '../logger';
import { copyFileSafe } from '../utils/file';
import { resolveFonixDataPath, voiceToolsDir } from '../voice/voiceToolPaths';
import { discoverGameVoiceAssets, pickFirstGameAsset } from './discoverGameVoiceAssets';

export type InstallVoiceToolsResult = {
  installDir: string;
  fonixPath: string;
  skipped: boolean;
  warnings: string[];
};

/**
 * Put `FonixData.cdf` into `data/tools/voice` for the bethesda-tools sidecar to mount.
 *
 * It is the one voice tool that cannot be fetched: Bethesda ships it with the game and
 * the Creation Kit, so it is copied from an install given with `--game-dir` or named by
 * `CREATION_KIT_DIR` and friends. FaceFXWrapper and xWMAEncode are baked into the
 * bethesda-tools image; ffmpeg comes from the distro package.
 */
export const installVoiceTools = async (opts?: {
  force?: boolean;
  gameDirs?: string[];
}): Promise<InstallVoiceToolsResult> => {
  const force = opts?.force === true;
  const gameDirs = opts?.gameDirs ?? [];
  const installDir = voiceToolsDir();
  const warnings: string[] = [];

  if (!force && fs.existsSync(resolveFonixDataPath())) {
    return { installDir, fonixPath: resolveFonixDataPath(), skipped: true, warnings };
  }

  fs.mkdirSync(installDir, { recursive: true });
  const dest = path.join(installDir, 'FonixData.cdf');
  const { fonixDataPath, root } = pickFirstGameAsset(discoverGameVoiceAssets(gameDirs));
  if (fonixDataPath) {
    log.info(`Copying FonixData.cdf from ${fonixDataPath}${root ? ` (${root})` : ''}`);
    copyFileSafe(fonixDataPath, dest);
  } else {
    warnings.push(
      'FonixData.cdf not found — pass --game-dir <Fallout 4 or Creation Kit install>, set CREATION_KIT_DIR, or set FONIX_DATA_PATH',
    );
  }

  return { installDir, fonixPath: resolveFonixDataPath(), skipped: false, warnings };
};
