import path from 'node:path';
import { registerArchiveFile } from '../import/mod/registration';
import type { ModImportJob } from '../import/mod/types';
import type { Tx } from '../db';
import type { GameId } from '../types';
import { scopedVortexFileHash } from './groupKey';

export const registerVortexPack = async (
  db: Tx,
  params: {
    groupId: number;
    fileName: string;
    zipPath: string;
    extractDir: string;
    contentHash: string;
    srcLang: string;
    tgtLang: string;
    game: GameId;
    nexusModId?: number | null;
    nexusModName?: string | null;
    sourceFolder?: string | null;
  },
): Promise<ModImportJob> => {
  return registerArchiveFile(
    db,
    params.fileName,
    params.zipPath,
    params.extractDir,
    params.srcLang,
    params.tgtLang,
    params.game,
    {
      nexusModId: params.nexusModId ?? undefined,
      nexusModName: params.nexusModName ?? undefined,
      sourceFolder: params.sourceFolder ?? undefined,
      vortexGroupId: params.groupId,
    },
    scopedVortexFileHash(params.groupId, params.contentHash),
  );
};

export const vortexExtractDir = (root: string, scopedHash: string): string =>
  path.join(root, scopedHash.replace(/[^a-zA-Z0-9._-]+/g, '_'));
