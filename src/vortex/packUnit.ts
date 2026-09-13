import path from 'node:path';
import { packFilesToZipPath } from '../web/export/zipPack';
import type { VortexInventoryUnit } from './types';

export const packVortexUnitZip = async (
  unit: VortexInventoryUnit,
  destPath: string,
): Promise<void> => {
  await packFilesToZipPath(
    unit.files.map((file) => ({
      name: file.relPath.replace(/\\/g, '/'),
      absPath: file.absPath,
    })),
    destPath,
  );
};

export const vortexUnitZipName = (unit: VortexInventoryUnit): string => {
  const safe = (unit.pluginFileName ?? unit.name).replace(/[<>:"/\\|?*]+/g, '_');
  return `${path.basename(safe, path.extname(safe))}.zip`;
};
