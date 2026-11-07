import path from 'node:path';
import { videoManifestName, type VideoManifest } from '../video/manifest';
import { packFilesToZipPath } from '../web/export/zipPack';
import type { VortexInventoryFile, VortexInventoryUnit } from './types';
import { isVideoRelPath } from './videoFiles';

export type PackVortexUnitOptions = {
  /**
   * What stands in for a video in the upload: its manifest. A unit's videos
   * are never sent themselves; without a describer they are left out.
   */
  describeVideo?: (file: VortexInventoryFile) => Promise<VideoManifest>;
};

export const packVortexUnitZip = async (
  unit: VortexInventoryUnit,
  destPath: string,
  options: PackVortexUnitOptions = {},
): Promise<void> => {
  const entries: Array<{ name: string; absPath?: string; data?: Buffer }> = [];
  for (const file of unit.files) {
    const name = file.relPath.replace(/\\/g, '/');
    if (!isVideoRelPath(file.relPath)) {
      entries.push({ name, absPath: file.absPath });
      continue;
    }
    if (!options.describeVideo) continue;
    const manifest = await options.describeVideo(file);
    entries.push({
      name: `${path.posix.dirname(name)}/${videoManifestName(path.basename(name))}`,
      data: Buffer.from(JSON.stringify(manifest, null, 2)),
    });
  }
  await packFilesToZipPath(entries, destPath);
};

export const vortexUnitZipName = (unit: VortexInventoryUnit): string => {
  const safe = (unit.pluginFileName ?? unit.name).replace(/[<>:"/\\|?*]+/g, '_');
  return `${path.basename(safe, path.extname(safe))}.zip`;
};
