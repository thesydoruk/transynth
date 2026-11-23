import fs from 'node:fs';
import path from 'node:path';
import { log } from '../logger';
import { copyFileSafe } from '../utils/file';
import { voiceToolsDir } from '../voice/voiceToolPaths';
import { collectVoiceAssetRoots } from './discoverGameVoiceAssets';

/**
 * The Starfield Creation Kit's lip tools, copied for the bethesda-tools sidecar.
 *
 * Starfield's lip animation (`.ffxanim`) comes from two console programs that ship
 * with its Creation Kit and are not redistributable: `Tools/LipGenerator` (with its own
 * `FonixData.cdf` and DLLs) and `Tools/FaceFX` (`ffxc.exe` and the `.facefx` rigs).
 * Both folders are copied whole into `<voice tools>/starfield/`, which the sidecar
 * mounts as `/data/tools/starfield/` (`services/bethesda-tools/starfieldTools.ts`
 * reads the same layout). Starfield's `FonixData.cdf` stays inside its own
 * `LipGenerator` folder, so it never meets the Fallout/Skyrim one in `<voice tools>/`.
 */
export const STARFIELD_TOOLS_SUBDIR = 'starfield';

/** Each folder copied, and the file that proves an install has it. */
const TOOL_DIRS = [
  { dir: 'LipGenerator', marker: 'LipGenerator.exe' },
  { dir: 'FaceFX', marker: 'ffxc.exe' },
] as const;

/** Where a root keeps them: the game / Creation Kit folder, or its `Tools` folder itself. */
const TOOLS_PARENTS = ['Tools', ''] as const;

/** The `Tools` folder under the first root that has both programs. */
export const findStarfieldLipTools = (
  roots: readonly string[],
): { root: string; toolsDir: string } | undefined => {
  for (const root of roots) {
    for (const parent of TOOLS_PARENTS) {
      const toolsDir = path.join(root, parent);
      const complete = TOOL_DIRS.every(({ dir, marker }) =>
        fs.existsSync(path.join(toolsDir, dir, marker)),
      );
      if (complete) return { root, toolsDir };
    }
  }
  return undefined;
};

const listFiles = (dir: string): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

/** True when every source file is already at `dest` with the same size. */
const alreadyCopied = (source: string, dest: string): boolean =>
  TOOL_DIRS.every(({ dir }) =>
    listFiles(path.join(source, dir)).every((name) => {
      const target = path.join(dest, dir, name);
      return (
        fs.existsSync(target) &&
        fs.statSync(target).size === fs.statSync(path.join(source, dir, name)).size
      );
    }),
  );

export type InstallStarfieldLipToolsResult = {
  /** `<voice tools>/starfield`. */
  installDir: string;
  /** The `Tools` folder copied from, when one was found. */
  source?: string;
  /** Files copied this run (0 when skipped or not found). */
  copied: number;
  skipped: boolean;
};

/**
 * Copy `Tools/LipGenerator` and `Tools/FaceFX` from the first given (or
 * `CREATION_KIT_DIR`-style) root that has them. Nothing happens when no root does:
 * the Starfield tools are optional, and the caller reports their absence as a note.
 */
export const installStarfieldLipTools = (opts?: {
  force?: boolean;
  gameDirs?: string[];
  /** Tests only: scan `gameDirs` alone, not the environment. */
  rootsOnly?: boolean;
}): InstallStarfieldLipToolsResult => {
  const installDir = path.join(voiceToolsDir(), STARFIELD_TOOLS_SUBDIR);
  const roots = collectVoiceAssetRoots(opts?.gameDirs ?? [], { rootsOnly: opts?.rootsOnly });
  const found = findStarfieldLipTools(roots.map((candidate) => candidate.root));
  if (!found) return { installDir, copied: 0, skipped: false };

  if (opts?.force !== true && alreadyCopied(found.toolsDir, installDir)) {
    return { installDir, source: found.toolsDir, copied: 0, skipped: true };
  }
  log.info(`Copying the Starfield lip tools from ${found.toolsDir}`);
  let copied = 0;
  for (const { dir } of TOOL_DIRS) {
    for (const name of listFiles(path.join(found.toolsDir, dir))) {
      copyFileSafe(path.join(found.toolsDir, dir, name), path.join(installDir, dir, name));
      copied += 1;
    }
  }
  return { installDir, source: found.toolsDir, copied, skipped: false };
};
