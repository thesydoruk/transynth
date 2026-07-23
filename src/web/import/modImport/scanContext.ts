import type { VortexFolderInfo } from '../../../utils/vortexFolder';
import type { ModScanContext } from './types';

export const modScanContextFromVortex = (vortex?: VortexFolderInfo): ModScanContext | undefined => {
  if (!vortex) return undefined;
  return {
    nexusModId: vortex.nexusModId,
    nexusModName: vortex.modName,
    sourceFolder: vortex.folderName,
  };
};
